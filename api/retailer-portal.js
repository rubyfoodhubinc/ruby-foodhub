const Stripe = require('stripe');
const { supabase } = require('./_lib/supabase');
const { resend, FROM_ADDRESS } = require('./_lib/resend');
const { requireRetailerSession } = require('./_lib/retailer-auth');
const { logAudit } = require('./_lib/admin-auth');
const { wholesaleCatalog } = require('./_lib/wholesale');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
  const { data, error } = await supabase
    .from('wholesale_orders')
    .update({ payment_status: 'paid' })
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
      if (!['stripe', 'pay_on_delivery'].includes(paymentMethod)) {
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
        orderItems.push({ product: entry.name, variant: entry.variant, quantity, wholesale_price: entry.wholesale_price });
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

      if (paymentMethod === 'pay_on_delivery') {
        try {
          const itemsText = orderItems.map((i) => `- ${i.quantity} x ${i.product} — ${i.variant} @ $${i.wholesale_price.toFixed(2)}`).join('\n');
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: 'sales@rubyfoodhub.com',
            subject: `Wholesale order ${order.order_number} (pay on delivery) — ${account.business_name}`,
            text: `${account.business_name} (${account.contact_name}, ${account.email}, ${account.phone || 'no phone'}) placed a PAY ON DELIVERY order.\n\n${itemsText}\n\nTotal due on delivery: $${total.toFixed(2)}\n\nConfirm the payment in Admin -> Wholesale once collected.`,
          });
        } catch (e) {
          console.error('wholesale order notification failed:', e.message);
        }
        return res.status(200).json({ success: true, orderNumber: order.order_number, paymentMethod });
      }

      // Stripe: charge the wholesale total via the usual hosted Checkout.
      const origin = req.headers.origin || `https://${req.headers.host}`;
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

      const origin = req.headers.origin || `https://${req.headers.host}`;
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
          .select('quantity, updated_at, products(name, variant)')
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
