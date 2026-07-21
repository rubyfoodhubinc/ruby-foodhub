const Stripe = require('stripe');
const { resend, FROM_ADDRESS } = require('./_lib/resend');
const { supabase } = require('./_lib/supabase');
const { NON_PRODUCT_LINE_NAMES, loadLineItems, buildOrderRow } = require('./_lib/orders');
const { logAudit } = require('./_lib/admin-auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

function itemsToText(items) {
  const productItems = items.filter((li) => !NON_PRODUCT_LINE_NAMES.has(li.description));
  if (!productItems.length) return '(unable to load line items)';
  return productItems.map((li) => `- ${li.quantity} x ${li.description} — $${li.amount.toFixed(2)}`).join('\n');
}

function buildOrderSummaryText(session, items) {
  const orderNumber = session.client_reference_id || session.id;
  const meta = session.metadata || {};
  const customerEmail = (session.customer_details && session.customer_details.email) || '';
  const total = ((session.amount_total || 0) / 100).toFixed(2);

  const placedAt = new Date((session.created || Date.now() / 1000) * 1000)
    .toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const lines = [
    `Order #${orderNumber}`,
    `Placed: ${placedAt} (Central Time)`,
    '',
    'Items:',
    itemsToText(items),
    '',
    `Subtotal: $${Number(meta.subtotal || 0).toFixed(2)}`,
    `Shipping: $${Number(meta.shippingFee || 0).toFixed(2)}`,
  ];

  if (meta.couponCode) {
    lines.push(`Discount (${meta.couponCode}): -$${Number(meta.discountAmount || 0).toFixed(2)}`);
  }

  lines.push(
    `Tip: $${Number(meta.tip || 0).toFixed(2)}`,
    `Total: $${total}`,
    '',
    'Delivery Details:',
    `Name: ${meta.fullName || '(not provided)'}`,
    `Email: ${customerEmail || '(not provided)'}`,
    `Phone: ${meta.phone || '(not provided)'}`,
    `Address: ${meta.address || '(not provided)'}`,
    `Zip: ${meta.zip || '(not provided)'}`,
    `Notes: ${meta.notes || '(none)'}`
  );

  return lines.join('\n');
}

async function sendOrderEmails(session, items) {
  const orderNumber = session.client_reference_id || session.id;
  const customerEmail = (session.customer_details && session.customer_details.email) || '';
  const total = ((session.amount_total || 0) / 100).toFixed(2);
  const summaryText = buildOrderSummaryText(session, items);
  const sent = { internal: false, customer: false };

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: 'sales@rubyfoodhub.com',
      subject: `New order #${orderNumber} — $${total}`,
      text: summaryText,
    });
    if (error) throw new Error(error.message || 'Failed to send internal order notification');
    sent.internal = true;
  } catch (err) {
    console.error(`Internal order notification failed for order ${orderNumber}:`, err.message);
  }

  if (customerEmail) {
    try {
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: customerEmail,
        subject: `Your Ruby FoodHub order #${orderNumber}`,
        text: `Thanks for your order!\n\n${summaryText}\n\nWe'll be in touch if we need anything else to get your order to you.`,
      });
      if (error) throw new Error(error.message || 'Failed to send customer confirmation');
      sent.customer = true;
    } catch (err) {
      console.error(`Customer confirmation email failed for order ${orderNumber}:`, err.message);
    }
  } else {
    console.error(`No customer email available for order ${orderNumber} — skipped customer confirmation`);
  }

  // System action (no admin user): recorded so the audit trail shows what
  // was emailed for every order.
  await logAudit(null, 'order_emails_sent', {
    order_id: orderNumber,
    internal_sent: sent.internal,
    customer_sent: sent.customer,
    customer_email: customerEmail || null,
  });
}

async function saveOrder(session, items) {
  const row = buildOrderRow(session, items);
  const { error } = await supabase
    .from('orders')
    .upsert(row, { onConflict: 'order_id' });

  // Supabase errors can have an empty .message with the real cause in
  // .code/.details/.hint, so serialize the whole object.
  if (error) throw new Error(JSON.stringify(error));
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // console.error rather than console.log: Vercel's runtime log view
  // reliably captures stderr (confirmed via a deprecation warning showing
  // up there) while stdout lines were absent — these are diagnostics, so
  // they go where they're guaranteed to be visible.
  console.error(`[webhook] received event type: ${event.type}`);

  // Wholesale orders ride the same Stripe account but are a separate flow:
  // mark the wholesale_orders row paid and notify — no retail order row,
  // no retail confirmation emails.
  if (event.type === 'checkout.session.completed' && event.data.object.metadata && event.data.object.metadata.wholesaleOrderId) {
    const session = event.data.object;
    const orderId = session.metadata.wholesaleOrderId;
    try {
      // Also record HOW it was paid: a pay-on-delivery order settled online
      // via the portal's Pay Now button really was paid by card, so the
      // Method column should say Stripe, not Pay on delivery.
      const { data, error } = await supabase
        .from('wholesale_orders')
        .update({ payment_status: 'paid', payment_method: 'stripe' })
        .eq('id', orderId)
        .neq('payment_status', 'paid')
        .select('order_number, total, retailer_id');
      if (error) throw new Error(JSON.stringify(error));

      if (data && data.length) {
        await logAudit(null, 'wholesale_order_paid', { order_id: orderId, order_number: data[0].order_number, stripe_session_id: session.id });
        try {
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: 'sales@rubyfoodhub.com',
            subject: `Wholesale order ${data[0].order_number} PAID via Stripe — $${Number(data[0].total).toFixed(2)}`,
            text: `Wholesale order ${data[0].order_number} was paid via Stripe ($${Number(data[0].total).toFixed(2)}). Details are in Admin -> Wholesale.`,
          });
        } catch (e) {
          console.error('[webhook] wholesale paid notification failed:', e.message);
        }
      }
      console.error(`[webhook] wholesale order ${orderId} marked paid`);
    } catch (err) {
      console.error(`[webhook] FAILED to mark wholesale order ${orderId} paid:`, err.message);
    }
    return res.status(200).json({ received: true });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.error(`[webhook] order ${session.client_reference_id} paid — session ${session.id}`);

    let items = [];
    try {
      items = await loadLineItems(stripe, session.id);
    } catch (err) {
      console.error(`Failed to load line items for session ${session.id}:`, err.message);
    }

    // Both are best-effort and independent: email failures shouldn't block
    // the database write and vice versa, and neither should fail the
    // webhook response — Stripe would otherwise retry and risk duplicate
    // customer emails / redundant work.
    await sendOrderEmails(session, items);
    try {
      await saveOrder(session, items);
      console.error(`[webhook] order ${session.client_reference_id} saved to Supabase OK`);
      await logAudit(null, 'order_saved', { order_id: session.client_reference_id || session.id, total: (session.amount_total || 0) / 100 });
    } catch (err) {
      console.error(`[webhook] FAILED to save order ${session.client_reference_id} to Supabase:`, err.message);
    }
  }

  res.status(200).json({ received: true });
}

// Vercel's default body parser would consume the stream before Stripe's
// signature check can run on the raw bytes, so it's disabled here. This
// must be attached to the exported function itself, not assigned to
// module.exports separately — a later `module.exports = fn` would
// otherwise silently discard it.
handler.config = {
  api: { bodyParser: false },
};

module.exports = handler;
