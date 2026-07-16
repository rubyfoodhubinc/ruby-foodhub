const Stripe = require('stripe');
const { resend, FROM_ADDRESS } = require('./_lib/resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function sendOrderEmails(session) {
  const orderNumber = session.client_reference_id || session.id;
  const meta = session.metadata || {};
  const customerEmail = (session.customer_details && session.customer_details.email) || '';
  const total = ((session.amount_total || 0) / 100).toFixed(2);

  let itemsText = '(unable to load line items)';
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    itemsText = lineItems.data
      .map((li) => `- ${li.quantity} x ${li.description} — $${(li.amount_total / 100).toFixed(2)}`)
      .join('\n');
  } catch (err) {
    console.error(`Failed to load line items for session ${session.id}:`, err.message);
  }

  const orderDetailsText = `Order #${orderNumber}
Total: $${total}

Items:
${itemsText}

Customer: ${meta.fullName || '(not provided)'}
Email: ${customerEmail || '(not provided)'}
Phone: ${meta.phone || '(not provided)'}
Address: ${meta.address || '(not provided)'}
Zip: ${meta.zip || '(not provided)'}
Notes: ${meta.notes || '(none)'}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: 'sales@rubyfoodhub.com',
      subject: `New order #${orderNumber} — $${total}`,
      text: orderDetailsText,
    });
    if (error) throw new Error(error.message || 'Failed to send internal order notification');
  } catch (err) {
    console.error(`Internal order notification failed for order ${orderNumber}:`, err.message);
  }

  if (customerEmail) {
    try {
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: customerEmail,
        subject: `Your Ruby FoodHub order #${orderNumber}`,
        text: `Thanks for your order!\n\nOrder #${orderNumber}\nTotal: $${total}\n\nItems:\n${itemsText}\n\nWe'll be in touch if we need anything else to get your order to you.`,
      });
      if (error) throw new Error(error.message || 'Failed to send customer confirmation');
    } catch (err) {
      console.error(`Customer confirmation email failed for order ${orderNumber}:`, err.message);
    }
  } else {
    console.error(`No customer email available for order ${orderNumber} — skipped customer confirmation`);
  }
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`Order ${session.client_reference_id} paid — session ${session.id}`);
    // Best-effort: email failures are logged but don't fail the webhook —
    // Stripe would otherwise retry and risk sending duplicate confirmations.
    await sendOrderEmails(session);
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
