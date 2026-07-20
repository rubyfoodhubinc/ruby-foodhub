const Stripe = require('stripe');
const { supabase } = require('./_lib/supabase');
const { resend, FROM_ADDRESS } = require('./_lib/resend');
const { requireRetailerSession } = require('./_lib/retailer-auth');
const { logAudit } = require('./_lib/admin-auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Only active products that HAVE a wholesale price are orderable wholesale.
async function wholesaleCatalog() {
  const { data, error } = await supabase
    .from('wholesale_prices')
    .select('wholesale_price, products!inner(id, slug, name, variant, active)')
    .eq('products.active', true);
  if (error) throw new Error(JSON.stringify(error));

  return (data || [])
    .map((row) => ({
      product_id: row.products.id,
      name: row.products.name,
      variant: row.products.variant,
      wholesale_price: Number(row.wholesale_price),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.wholesale_price - b.wholesale_price);
}

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
