const { supabase } = require('./_lib/supabase');
const { requireSession, logAudit } = require('./_lib/admin-auth');
const { resend, isValidEmail, FROM_ADDRESS } = require('./_lib/resend');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RETAILER_EMAIL_FOOTER = `
<hr style="border:none;border-top:1px solid #e5e0dc;margin:32px 0 16px">
<p style="font-size:12px;color:#8a837d;font-family:sans-serif;line-height:1.6">
  Ruby FoodHub Inc. · Texas, USA · Wholesale Partner Communication<br>
  Questions? Reply to this email or write to <a href="mailto:sales@rubyfoodhub.com">sales@rubyfoodhub.com</a>.
</p>`;

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, action } = req.body || {};
  const actor = await requireSession(token);
  if (!actor) return res.status(401).json({ error: 'Session expired — please sign in again.' });

  try {
    if (action === 'retailers') {
      const [{ data: retailers, error: rErr }, { data: orders, error: oErr }] = await Promise.all([
        supabase.from('retailer_accounts')
          .select('id, business_name, contact_name, email, phone, address, account_status, last_login_at, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('wholesale_orders').select('retailer_id, items, total, payment_status'),
      ]);
      if (rErr) throw new Error(JSON.stringify(rErr));
      if (oErr) throw new Error(JSON.stringify(oErr));

      const stats = new Map();
      for (const o of orders || []) {
        if (!stats.has(o.retailer_id)) {
          stats.set(o.retailer_id, { orderCount: 0, paidTotal: 0, pendingTotal: 0, qtyByProduct: {} });
        }
        const s = stats.get(o.retailer_id);
        s.orderCount += 1;
        const paid = o.payment_status === 'paid' || o.payment_status === 'confirmed_by_admin';
        if (paid) s.paidTotal += Number(o.total) || 0;
        else s.pendingTotal += Number(o.total) || 0;
        for (const item of (Array.isArray(o.items) ? o.items : [])) {
          s.qtyByProduct[item.product] = (s.qtyByProduct[item.product] || 0) + (Number(item.quantity) || 0);
        }
      }

      return res.status(200).json({
        retailers: (retailers || []).map((r) => ({ ...r, stats: stats.get(r.id) || { orderCount: 0, paidTotal: 0, pendingTotal: 0, qtyByProduct: {} } })),
      });
    }

    if (action === 'retailer-orders') {
      const { retailerId } = req.body;
      if (!retailerId) return res.status(400).json({ error: 'retailerId required.' });
      const { data, error } = await supabase
        .from('wholesale_orders')
        .select('*')
        .eq('retailer_id', retailerId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ orders: data });
    }

    if (action === 'confirm-payment') {
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: 'orderId required.' });

      const { data, error } = await supabase
        .from('wholesale_orders')
        .update({ payment_status: 'confirmed_by_admin' })
        .eq('id', orderId)
        .eq('payment_method', 'pay_on_delivery')
        .eq('payment_status', 'pending')
        .select('order_number, total');
      if (error) throw new Error(JSON.stringify(error));
      if (!data || !data.length) {
        return res.status(400).json({ error: 'Order not found, not pay-on-delivery, or already confirmed.' });
      }

      await logAudit(actor.id, 'wholesale_payment_confirmed', { order_id: orderId, order_number: data[0].order_number, total: data[0].total });
      return res.status(200).json({ success: true, order: data[0] });
    }

    if (action === 'set-order-status') {
      const { orderId, status } = req.body;
      if (!orderId || !['pending', 'confirmed', 'fulfilled'].includes(status)) {
        return res.status(400).json({ error: 'orderId and status pending/confirmed/fulfilled required.' });
      }
      const { data, error } = await supabase
        .from('wholesale_orders')
        .update({ order_status: status })
        .eq('id', orderId)
        .neq('order_status', 'canceled')
        .select('order_number');
      if (error) throw new Error(JSON.stringify(error));
      if (!data || !data.length) return res.status(404).json({ error: 'Order not found (or it has been canceled).' });

      await logAudit(actor.id, 'wholesale_order_status_change', { order_id: orderId, order_number: data[0].order_number, status });
      return res.status(200).json({ success: true });
    }

    if (action === 'cancel-order') {
      const { orderId, reason } = req.body;
      const cleanReason = String(reason || '').trim();
      if (!orderId || !cleanReason) {
        return res.status(400).json({ error: 'A cancellation reason is required.' });
      }

      const { data: order, error: getErr } = await supabase
        .from('wholesale_orders')
        .select('id, order_number, total, payment_status, order_status, retailer_accounts(business_name, email)')
        .eq('id', orderId)
        .maybeSingle();
      if (getErr) throw new Error(JSON.stringify(getErr));
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (order.order_status === 'canceled') return res.status(400).json({ error: 'Order is already canceled.' });

      const { error } = await supabase
        .from('wholesale_orders')
        .update({ order_status: 'canceled', cancel_reason: cleanReason, canceled_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(actor.id, 'wholesale_order_canceled', {
        order_id: orderId, order_number: order.order_number,
        reason: cleanReason, payment_status_at_cancel: order.payment_status,
      });

      // Tell the retailer, including the reason.
      const retailer = order.retailer_accounts;
      if (retailer && isValidEmail(retailer.email)) {
        try {
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: retailer.email,
            subject: `Ruby FoodHub — order ${order.order_number} has been canceled`,
            html: `<p style="font-family:sans-serif;line-height:1.6">Hi ${retailer.business_name},<br><br>` +
              `Your wholesale order <strong>${order.order_number}</strong> ($${Number(order.total).toFixed(2)}) has been canceled.<br><br>` +
              `<strong>Reason:</strong> ${cleanReason}<br><br>` +
              `If you have questions, just reply to this email.</p>` + RETAILER_EMAIL_FOOTER,
          });
        } catch (e) {
          console.error('cancel notification email failed:', e.message);
        }
      }

      const wasPaid = order.payment_status === 'paid';
      return res.status(200).json({
        success: true,
        note: wasPaid ? 'This order was PAID via Stripe — issue the refund from the Stripe dashboard (Payments → find the charge → Refund).' : null,
      });
    }

    if (action === 'set-account-status') {
      const { retailerId, status } = req.body;
      if (!retailerId || !['active', 'pending', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'retailerId and status active/pending/suspended required.' });
      }
      const { data, error } = await supabase
        .from('retailer_accounts')
        .update({ account_status: status })
        .eq('id', retailerId)
        .select('business_name, email');
      if (error) throw new Error(JSON.stringify(error));
      if (!data || !data.length) return res.status(404).json({ error: 'Retailer not found.' });

      // Suspension (or demotion to pending) revokes live portal sessions.
      if (status !== 'active') {
        await supabase.from('retailer_sessions').delete().eq('retailer_id', retailerId);
      }

      await logAudit(actor.id, 'retailer_account_status_change', { retailer_id: retailerId, business_name: data[0].business_name, status });

      // Tell the retailer when they're approved.
      if (status === 'active') {
        try {
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: data[0].email,
            subject: 'Your Ruby FoodHub wholesale account is approved',
            html: `<p style="font-family:sans-serif">Good news — your Ruby FoodHub retailer account for <strong>${data[0].business_name}</strong> has been approved. You can now sign in and place wholesale orders at <a href="https://www.rubyfoodhub.com/retailer">rubyfoodhub.com/retailer</a>.</p>` + RETAILER_EMAIL_FOOTER,
          });
        } catch (e) {
          console.error('approval email failed:', e.message);
        }
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'email-retailers') {
      const { retailerIds, reason, subject, html } = req.body;
      if (!Array.isArray(retailerIds) || !retailerIds.length) {
        return res.status(400).json({ error: 'Select at least one retailer.' });
      }
      if (!String(subject || '').trim() || !String(html || '').trim()) {
        return res.status(400).json({ error: 'Subject and body are required.' });
      }

      const { data: recipients, error } = await supabase
        .from('retailer_accounts')
        .select('id, business_name, email')
        .in('id', retailerIds);
      if (error) throw new Error(JSON.stringify(error));

      let sent = 0;
      const failed = [];
      for (let i = 0; i < (recipients || []).length; i++) {
        const r = recipients[i];
        if (!isValidEmail(r.email)) continue;
        const { error: sendErr } = await resend.emails.send({
          from: FROM_ADDRESS,
          to: r.email,
          subject: subject.trim(),
          html: html + RETAILER_EMAIL_FOOTER,
        });
        if (sendErr) failed.push(r.email);
        else sent += 1;
        if ((i + 1) % 8 === 0) await sleep(1000);
      }

      await logAudit(actor.id, 'retailer_email_sent', {
        reason: reason || 'custom', subject: subject.trim(),
        recipient_count: sent, retailer_ids: retailerIds, failed,
      });
      return res.status(200).json({ success: true, sent, failed });
    }

    if (action === 'wholesale-prices') {
      const { data, error } = await supabase
        .from('wholesale_prices')
        .select('product_id, wholesale_price');
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ prices: data });
    }

    if (action === 'set-wholesale-price') {
      const { productId, price } = req.body;
      const cleanPrice = Number(price);
      if (!productId || !Number.isFinite(cleanPrice) || cleanPrice <= 0) {
        return res.status(400).json({ error: 'A productId and positive price are required.' });
      }

      const { data: before } = await supabase
        .from('wholesale_prices').select('wholesale_price').eq('product_id', productId).maybeSingle();

      const { error } = await supabase
        .from('wholesale_prices')
        .upsert({ product_id: productId, wholesale_price: cleanPrice, updated_at: new Date().toISOString() }, { onConflict: 'product_id' });
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(actor.id, 'wholesale_price_change', {
        product_id: productId,
        old_price: before ? Number(before.wholesale_price) : null,
        new_price: cleanPrice,
      });
      return res.status(200).json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin-wholesale error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

handler.config = { maxDuration: 60 };
module.exports = handler;
