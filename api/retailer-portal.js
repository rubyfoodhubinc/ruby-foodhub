const { applyCors } = require('./_lib/cors');
const Stripe = require('stripe');
const { supabase } = require('./_lib/supabase');
const { resend, FROM_ADDRESS } = require('./_lib/resend');
const { requireRetailerSession } = require('./_lib/retailer-auth');
const { logAudit } = require('./_lib/admin-auth');
const { wholesaleCatalog } = require('./_lib/wholesale');
const { applyStockChange } = require('./_lib/stock');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe success/cancel URLs must be real https pages. Requests from the
// native apps carry a capacitor://localhost (iOS) or https://localhost
// (Android) origin, which Stripe can't redirect to — fall back to the
// live site (the API host) in that case.
function returnOrigin(req) {
  const origin = req.headers.origin || '';
  if (/^https:\/\//.test(origin) && !origin.startsWith('https://localhost')) return origin;
  return `https://${req.headers.host}`;
}

// Support topics a retailer can raise, mapped to a readable label.
const SUPPORT_TOPICS = {
  order_issue: 'Order Issue',
  delivery: 'Delivery / Scheduling',
  payment: 'Payment / Billing',
  product: 'Product Question',
  account: 'Account / Access',
  other: 'General / Other',
};

async function markOrderPaid(orderId, stripeSessionId) {
  // Idempotent: webhook and the on-return verification can both call this.
  // payment_method is set to 'stripe' because that's how it was actually
  // paid, even if the order started life as pay-on-delivery.
  const { data, error } = await supabase
    .from('wholesale_orders')
    .update({ payment_status: 'paid', payment_method: 'stripe' })
    .eq('id', orderId)
    .neq('payment_status', 'paid')
    .select('order_number, retailer_id, total');
  if (error) throw new Error(JSON.stringify(error));
  if (data && data.length) {
    await logAudit(null, 'wholesale_order_paid', { order_id: orderId, order_number: data[0].order_number, stripe_session_id: stripeSessionId });
  }
  return data && data[0];
}

module.exports = async (req, res) => {
  // Native app (Capacitor) requests are cross-origin; answer preflight.
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, token } = req.body || {};
  const account = await requireRetailerSession(token);
  if (!account) return res.status(401).json({ error: 'Session expired — please sign in again.' });

  // Pending/suspended accounts can see their status and profile, nothing else.
  const restricted = account.account_status !== 'active';

  try {
    if (action === 'catalog') {
      if (restricted) return res.status(403).json({ error: 'Your account must be approved before you can view wholesale pricing.' });
      return res.status(200).json({ catalog: await wholesaleCatalog() });
    }

    if (action === 'orders') {
      if (restricted) return res.status(200).json({ orders: [] });
      const { data, error } = await supabase
        .from('wholesale_orders')
        .select('*')
        .eq('retailer_id', account.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ orders: data });
    }

    if (action === 'profile-update') {
      const { businessName, contactName, phone, address } = req.body;
      const patch = {
        business_name: String(businessName || '').trim() || account.business_name,
        contact_name: String(contactName || '').trim() || account.contact_name,
        phone: String(phone || '').trim() || null,
        address: String(address || '').trim() || null,
      };
      const { error } = await supabase.from('retailer_accounts').update(patch).eq('id', account.id);
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ success: true });
    }

    if (action === 'place-order') {
      if (restricted) return res.status(403).json({ error: 'Your account must be approved before ordering.' });

      const { items, paymentMethod } = req.body;
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items in the order.' });
      if (!['stripe', 'pay_on_delivery', 'cash', 'zelle'].includes(paymentMethod)) {
        return res.status(400).json({ error: 'Choose a payment method.' });
      }

      // Server-side pricing only — the client sends product ids + quantities.
      const catalog = await wholesaleCatalog();
      const byId = new Map(catalog.map((c) => [c.product_id, c]));

      const orderItems = [];
      let total = 0;
      for (const item of items) {
        const entry = byId.get(item.product_id);
        const quantity = Math.max(1, Math.min(1000, Number(item.quantity) || 0));
        if (!entry || !Number(item.quantity)) continue;
        orderItems.push({ product_id: entry.product_id, product: entry.name, variant: entry.variant, quantity, wholesale_price: entry.wholesale_price });
        total += entry.wholesale_price * quantity;
      }
      if (!orderItems.length) return res.status(400).json({ error: 'No valid items in the order.' });
      total = Math.round(total * 100) / 100;

      const { data: order, error } = await supabase
        .from('wholesale_orders')
        .insert({
          retailer_id: account.id,
          items: orderItems,
          total,
          payment_method: paymentMethod,
        })
        .select('*')
        .single();
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(null, 'wholesale_order_placed', {
        order_id: order.id, order_number: order.order_number,
        retailer_id: account.id, business_name: account.business_name,
        total, payment_method: paymentMethod,
      });

      if (paymentMethod !== 'stripe') {
        // Cash, Zelle, and (legacy) pay-on-delivery orders submit unpaid and
        // stay owed until the money is verified and confirmed by an admin.
        const methodLabel = paymentMethod === 'zelle' ? 'ZELLE' : paymentMethod === 'cash' ? 'CASH (on delivery)' : 'PAY ON DELIVERY';
        try {
          const itemsText = orderItems.map((i) => `- ${i.quantity} x ${i.product} — ${i.variant} @ $${i.wholesale_price.toFixed(2)}`).join('\n');
          const tail = paymentMethod === 'zelle'
            ? `They were shown the Zelle details (bankpay@rubyfoodhub.com) and asked to report the payment once sent. Verify the money, then confirm in Admin -> Wholesale.`
            : `Confirm the payment in Admin -> Wholesale once collected.`;
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: 'sales@rubyfoodhub.com',
            subject: `Wholesale order ${order.order_number} (${methodLabel.toLowerCase()}) — ${account.business_name}`,
            text: `${account.business_name} (${account.contact_name}, ${account.email}, ${account.phone || 'no phone'}) placed a ${methodLabel} order.\n\n${itemsText}\n\nTotal due: $${total.toFixed(2)}\n\n${tail}`,
          });
        } catch (e) {
          console.error('wholesale order notification failed:', e.message);
        }
        return res.status(200).json({ success: true, orderNumber: order.order_number, paymentMethod, order });
      }

      // Stripe: charge the wholesale total via the usual hosted Checkout.
      const origin = returnOrigin(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: orderItems.map((i) => ({
          price_data: {
            currency: 'usd',
            product_data: { name: `${i.product} — ${i.variant} (wholesale)` },
            unit_amount: Math.round(i.wholesale_price * 100),
          },
          quantity: i.quantity,
        })),
        customer_email: account.email,
        client_reference_id: order.order_number,
        success_url: `${origin}/retailer?ws_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/retailer?ws_canceled=1`,
        metadata: { wholesaleOrderId: order.id, orderNumber: order.order_number },
      });

      await supabase.from('wholesale_orders').update({ stripe_session_id: session.id }).eq('id', order.id);

      return res.status(200).json({ success: true, orderNumber: order.order_number, paymentMethod, checkoutUrl: session.url });
    }

    if (action === 'pay-order') {
      // Lets a retailer pay online for ANY unpaid order still on their
      // account — whether they placed it themselves as pay-on-delivery, or
      // an admin added it for them. Reuses the same Stripe/webhook path as
      // place-order, so payment_status flips to 'paid' the same way.
      if (restricted) return res.status(403).json({ error: 'Your account must be approved before paying online.' });
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: 'orderId required.' });

      const { data: order, error } = await supabase
        .from('wholesale_orders')
        .select('*')
        .eq('id', orderId)
        .eq('retailer_id', account.id)
        .maybeSingle();
      if (error) throw new Error(JSON.stringify(error));
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (order.order_status === 'canceled') return res.status(400).json({ error: 'This order has been canceled.' });
      if (order.payment_status !== 'pending') return res.status(400).json({ error: 'This order is not awaiting payment.' });

      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.length) return res.status(400).json({ error: 'Order has no items to charge.' });

      const origin = returnOrigin(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: items.map((i) => ({
          price_data: {
            currency: 'usd',
            product_data: { name: `${i.product} — ${i.variant} (wholesale)` },
            unit_amount: Math.round(Number(i.wholesale_price) * 100),
          },
          quantity: i.quantity,
        })),
        customer_email: account.email,
        client_reference_id: order.order_number,
        success_url: `${origin}/retailer?ws_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/retailer?ws_canceled=1`,
        metadata: { wholesaleOrderId: order.id, orderNumber: order.order_number },
      });

      await supabase.from('wholesale_orders').update({ stripe_session_id: session.id }).eq('id', order.id);

      return res.status(200).json({ success: true, checkoutUrl: session.url });
    }

    if (action === 'stock') {
      if (restricted) return res.status(403).json({ error: 'Your account must be approved to view stock.' });
      const [{ data: stock, error: sErr }, { data: movements, error: mErr }] = await Promise.all([
        supabase.from('retailer_stock')
          .select('product_id, quantity, updated_at, products(name, variant)')
          .eq('retailer_id', account.id),
        supabase.from('stock_movements')
          .select('change, note, created_at, products(name, variant)')
          .eq('retailer_id', account.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (sErr) throw new Error(JSON.stringify(sErr));
      if (mErr) throw new Error(JSON.stringify(mErr));
      return res.status(200).json({ stock: stock || [], movements: movements || [] });
    }

    if (action === 'report-sold') {
      // Retailer records quantities sold (or otherwise gone) at their
      // location — daily, weekly, or whenever — so stock reflects reality
      // instead of sitting at the delivered amount. Decrements only: stock
      // can only ever INCREASE via deliveries recorded by our team.
      if (restricted) return res.status(403).json({ error: 'Your account must be approved to update stock.' });

      const { productId, quantity, note } = req.body;
      const sold = Math.trunc(Number(quantity));
      if (!productId || !Number.isFinite(sold) || sold <= 0) {
        return res.status(400).json({ error: 'Enter how many units were sold (a positive whole number).' });
      }

      // Only products actually stocked at this location can be reported.
      const { data: stockRow, error: stErr } = await supabase
        .from('retailer_stock')
        .select('quantity')
        .eq('retailer_id', account.id)
        .eq('product_id', productId)
        .maybeSingle();
      if (stErr) throw new Error(JSON.stringify(stErr));
      if (!stockRow) return res.status(400).json({ error: 'That product is not tracked at your location yet.' });
      if (sold > stockRow.quantity) {
        return res.status(400).json({ error: `You only have ${stockRow.quantity} on hand — cannot report ${sold} sold.` });
      }

      const cleanNote = String(note || '').trim().slice(0, 300);
      const newQty = await applyStockChange(
        account.id, productId, -sold,
        'Sold — reported by retailer' + (cleanNote ? `: ${cleanNote}` : ''),
        null
      );

      await logAudit(null, 'retailer_stock_sold', {
        retailer_id: account.id, business_name: account.business_name,
        product_id: productId, quantity_sold: sold, new_quantity: newQty, note: cleanNote || null,
      });

      return res.status(200).json({ success: true, quantity: newQty });
    }

    if (action === 'claim-payment') {
      // Retailer reports they've paid outside Stripe (cash handed to our
      // team, or a Zelle transfer). The order does NOT clear — it enters
      // 'awaiting_confirmation' and stays owed until an admin verifies the
      // money and confirms, or rejects the claim back to unpaid.
      if (restricted) return res.status(403).json({ error: 'Your account must be approved first.' });

      const { orderId, method, reference } = req.body;
      if (!['cash', 'zelle'].includes(method)) {
        return res.status(400).json({ error: 'Payment method must be cash or zelle.' });
      }
      if (!orderId) return res.status(400).json({ error: 'orderId required.' });

      const { data: order, error: getErr } = await supabase
        .from('wholesale_orders')
        .select('id, order_number, total, payment_status, order_status')
        .eq('id', orderId)
        .eq('retailer_id', account.id)
        .maybeSingle();
      if (getErr) throw new Error(JSON.stringify(getErr));
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (order.order_status === 'canceled') return res.status(400).json({ error: 'This order has been canceled.' });
      if (order.payment_status !== 'pending') {
        return res.status(400).json({ error: 'This order is not awaiting payment.' });
      }

      const cleanRef = String(reference || '').trim().slice(0, 200);
      const { error } = await supabase
        .from('wholesale_orders')
        .update({
          payment_status: 'awaiting_confirmation',
          claimed_payment_method: method,
          claimed_at: new Date().toISOString(),
          claimed_reference: cleanRef || null,
        })
        .eq('id', orderId)
        .eq('payment_status', 'pending');
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(null, 'wholesale_payment_claimed', {
        order_id: orderId, order_number: order.order_number,
        retailer_id: account.id, business_name: account.business_name,
        method, reference: cleanRef || null, total: order.total,
      });

      // Tell the sales team there's money to verify.
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: 'sales@rubyfoodhub.com',
          replyTo: account.email,
          subject: `Payment claim (${method}) — order ${order.order_number} — ${account.business_name}`,
          text:
`${account.business_name} (${account.contact_name || ''}, ${account.email}) reports they PAID order ${order.order_number} ($${Number(order.total).toFixed(2)}) by ${method.toUpperCase()}.
${cleanRef ? `\nReference: ${cleanRef}\n` : ''}
Verify the money was received, then confirm (or reject) in Admin -> Wholesale. The order stays owed until confirmed.`,
        });
      } catch (e) {
        console.error('payment claim notification failed:', e.message);
      }

      return res.status(200).json({ success: true, orderNumber: order.order_number });
    }

    if (action === 'contact-support') {
      const { topic, subject, message, orderNumber } = req.body;
      const cleanSubject = String(subject || '').trim();
      const cleanMessage = String(message || '').trim();
      const topicLabel = SUPPORT_TOPICS[topic] || SUPPORT_TOPICS.other;

      if (!cleanSubject || !cleanMessage) {
        return res.status(400).json({ error: 'A subject and message are required.' });
      }
      if (cleanMessage.length > 5000) {
        return res.status(400).json({ error: 'Message is too long (max 5000 characters).' });
      }

      const orderLine = String(orderNumber || '').trim()
        ? `Regarding order: ${String(orderNumber).trim()}\n`
        : '';

      // Sent to the sales team; reply-to is the retailer so the team can
      // respond to them directly. Account context is attached automatically.
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: 'sales@rubyfoodhub.com',
        replyTo: account.email,
        subject: `[Retailer Support · ${topicLabel}] ${cleanSubject}`,
        text:
`Support request from a wholesale retailer.

Topic: ${topicLabel}
${orderLine}
Business: ${account.business_name}
Contact: ${account.contact_name || '(not set)'}
Email: ${account.email}
Phone: ${account.phone || '(not set)'}
Account status: ${account.account_status}

Subject: ${cleanSubject}

Message:
${cleanMessage}

— Reply to this email to respond directly to the retailer.`,
      });
      if (error) throw new Error(error.message || 'Could not send your message');

      // Acknowledgement copy to the retailer so they have a record.
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: account.email,
          subject: `We received your message: ${cleanSubject}`,
          text:
`Hi ${account.contact_name || account.business_name},

Thanks for reaching out to the Ruby FoodHub wholesale team. We've received your message and will get back to you as soon as possible.

Topic: ${topicLabel}
${orderLine}Your message:
${cleanMessage}

If you need to add anything, just reply to this email.

— Ruby FoodHub Wholesale Team`,
        });
      } catch (e) {
        console.error('support acknowledgement email failed:', e.message);
      }

      await logAudit(null, 'retailer_support_request', {
        retailer_id: account.id, business_name: account.business_name,
        topic, subject: cleanSubject, order_number: orderNumber || null,
      });

      return res.status(200).json({ success: true });
    }

    if (action === 'upload-logo') {
      const { imageBase64, contentType } = req.body;
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      const ct = allowed.includes(contentType) ? contentType : 'image/jpeg';

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return res.status(400).json({ error: 'No image received.' });
      }
      let buffer;
      try { buffer = Buffer.from(imageBase64, 'base64'); } catch (e) { buffer = null; }
      if (!buffer || buffer.length < 100) {
        return res.status(400).json({ error: 'Invalid image data.' });
      }
      if (buffer.length > 1.5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large — please use an image under 1.5MB.' });
      }

      const bucket = 'retailer-logos';
      // Idempotent: creating an existing bucket errors, which we ignore.
      await supabase.storage.createBucket(bucket, { public: true }).catch(() => {});

      const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
      const path = `${account.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: ct, upsert: true });
      if (upErr) throw new Error(upErr.message || 'Upload failed');

      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
      // Cache-bust so a replaced logo shows immediately everywhere.
      const logoUrl = pub.publicUrl + '?v=' + Date.now();
      const { error: dbErr } = await supabase.from('retailer_accounts').update({ logo_url: logoUrl }).eq('id', account.id);
      if (dbErr) throw new Error(JSON.stringify(dbErr));

      return res.status(200).json({ success: true, logoUrl });
    }

    if (action === 'delete-account') {
      // Self-service account deletion (App Store guideline 5.1.1(v)).
      // Personal data is wiped immediately and sessions are revoked, so
      // the account can never be used again. Order rows are retained
      // (anonymized via this account) because they are financial records
      // needed for accounting/tax — disclosed in the privacy policy.
      const { confirm } = req.body;
      if (String(confirm || '').trim().toUpperCase() !== 'DELETE') {
        return res.status(400).json({ error: 'Type DELETE to confirm account deletion.' });
      }

      // Outstanding balance doesn't block deletion, but the team must know.
      const { data: owed } = await supabase
        .from('wholesale_orders')
        .select('order_number, total, payment_status, order_status')
        .eq('retailer_id', account.id)
        .in('payment_status', ['pending', 'awaiting_confirmation'])
        .neq('order_status', 'canceled');
      const outstanding = (owed || []).reduce((s, o) => s + (Number(o.total) || 0), 0);

      const stamp = new Date().toISOString();
      const { error } = await supabase
        .from('retailer_accounts')
        .update({
          business_name: 'Deleted Account',
          contact_name: null,
          // Unique but unusable — the email column has a UNIQUE constraint.
          email: `deleted-${account.id}@deleted.invalid`,
          password_hash: 'deleted-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
          phone: null,
          address: null,
          logo_url: null,
          account_status: 'closed',
          deleted_at: stamp,
        })
        .eq('id', account.id);
      if (error) throw new Error(JSON.stringify(error));

      // Revoke every live session for this account.
      await supabase.from('retailer_sessions').delete().eq('retailer_id', account.id);

      // Remove the uploaded logo from storage too.
      try {
        await supabase.storage.from('retailer-logos')
          .remove([`${account.id}.jpg`, `${account.id}.png`, `${account.id}.webp`]);
      } catch (e) {
        console.error('logo cleanup on account deletion failed:', e.message);
      }

      await logAudit(null, 'retailer_account_deleted', {
        retailer_id: account.id, business_name: account.business_name,
        email: account.email, outstanding_balance: outstanding,
        outstanding_orders: (owed || []).map((o) => o.order_number),
      });

      // Confirmation to the retailer at their real address, sent before
      // they lose access — plus a heads-up to the team.
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: account.email,
          subject: 'Your Ruby FoodHub wholesale account has been deleted',
          text:
`Hi ${account.contact_name || account.business_name},

Your Ruby FoodHub wholesale account (${account.email}) has been deleted as you requested. Your personal details have been removed from our systems and you can no longer sign in.

Please note: past order and payment records are kept as required for accounting and tax purposes, and are no longer linked to your personal details.${outstanding > 0 ? `

Important: our records show an outstanding balance of $${outstanding.toFixed(2)}. Deleting your account does not cancel this balance — our team will contact you about settling it.` : ''}

If you'd like to work with us again, you're welcome to sign up any time at rubyfoodhub.com/retailer.

— Ruby FoodHub Wholesale Team`,
        });
      } catch (e) {
        console.error('deletion confirmation email failed:', e.message);
      }

      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: 'sales@rubyfoodhub.com',
          subject: `Retailer account deleted: ${account.business_name}${outstanding > 0 ? ' — OUTSTANDING BALANCE' : ''}`,
          text:
`${account.business_name} (${account.email}) deleted their wholesale account from the portal.

Outstanding balance: $${outstanding.toFixed(2)}${outstanding > 0 ? `
Unpaid orders: ${(owed || []).map((o) => o.order_number).join(', ')}

Follow up on payment — the order records are retained in the admin dashboard.` : ' (nothing owed)'}`,
        });
      } catch (e) {
        console.error('deletion notification to sales failed:', e.message);
      }

      return res.status(200).json({ success: true, outstanding });
    }

    if (action === 'verify-stripe') {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ error: 'Missing session id.' });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const orderId = session.metadata && session.metadata.wholesaleOrderId;
      if (session.payment_status === 'paid' && orderId) {
        await markOrderPaid(orderId, session.id);
        return res.status(200).json({ paid: true, orderNumber: session.metadata.orderNumber });
      }
      return res.status(200).json({ paid: false });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('retailer-portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
