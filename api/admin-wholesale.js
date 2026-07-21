const { supabase } = require('./_lib/supabase');
const { requireSession, logAudit } = require('./_lib/admin-auth');
const { resend, isValidEmail, FROM_ADDRESS } = require('./_lib/resend');
const { wholesaleCatalog } = require('./_lib/wholesale');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Applies one stock change atomically-enough for this scale: read current,
// clamp at zero, upsert, and append the ledger row. Returns the new quantity.
async function applyStockChange(retailerId, productId, change, note, adminUserId) {
  const { data: current, error: getErr } = await supabase
    .from('retailer_stock')
    .select('quantity')
    .eq('retailer_id', retailerId)
    .eq('product_id', productId)
    .maybeSingle();
  if (getErr) throw new Error(JSON.stringify(getErr));

  const newQty = (current ? current.quantity : 0) + change;
  if (newQty < 0) {
    throw new Error(`Stock cannot go below zero (current: ${current ? current.quantity : 0}, change: ${change}).`);
  }

  const { error: upErr } = await supabase
    .from('retailer_stock')
    .upsert(
      { retailer_id: retailerId, product_id: productId, quantity: newQty, updated_at: new Date().toISOString() },
      { onConflict: 'retailer_id,product_id' }
    );
  if (upErr) throw new Error(JSON.stringify(upErr));

  const { error: mvErr } = await supabase
    .from('stock_movements')
    .insert({ retailer_id: retailerId, product_id: productId, change, note: note || null, created_by: adminUserId || null });
  if (mvErr) throw new Error(JSON.stringify(mvErr));

  return newQty;
}

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
        supabase.from('wholesale_orders').select('retailer_id, items, total, payment_status, order_status'),
      ]);
      if (rErr) throw new Error(JSON.stringify(rErr));
      if (oErr) throw new Error(JSON.stringify(oErr));

      const stats = new Map();
      for (const o of orders || []) {
        // Canceled orders carry no money owed and no goods — a canceled
        // order's payment_status stays 'pending' forever, so counting it
        // would inflate the Pending $ column indefinitely.
        if (o.order_status === 'canceled') continue;
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

    if (action === 'all-orders') {
      const { data, error } = await supabase
        .from('wholesale_orders')
        .select('id, order_number, items, total, payment_method, payment_status, order_status, cancel_reason, created_at, retailer_accounts(business_name)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ orders: data });
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

    if (action === 'catalog') {
      return res.status(200).json({ catalog: await wholesaleCatalog() });
    }

    if (action === 'create-order') {
      // Admin records an order directly onto a retailer's account (e.g. a
      // phone-in or in-person order). Always created as pay-on-delivery —
      // the retailer can pay online later via their portal's Pay Now
      // button, or pay in person and have the admin confirm it.
      // markFulfilled=true is the "billable delivery" path: the goods are
      // already at the retailer's location, so the order is created as
      // fulfilled, their stock is incremented, and payment is due now.
      const { retailerId, items, note, markFulfilled } = req.body;
      const fulfillNow = markFulfilled === true;
      if (!retailerId || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'retailerId and at least one item are required.' });
      }

      const { data: retailer, error: rErr } = await supabase
        .from('retailer_accounts')
        .select('id, business_name, email')
        .eq('id', retailerId)
        .maybeSingle();
      if (rErr) throw new Error(JSON.stringify(rErr));
      if (!retailer) return res.status(404).json({ error: 'Retailer not found.' });

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
      if (!orderItems.length) return res.status(400).json({ error: 'No valid items selected.' });
      total = Math.round(total * 100) / 100;

      const { data: order, error } = await supabase
        .from('wholesale_orders')
        .insert({
          retailer_id: retailerId,
          items: orderItems,
          total,
          payment_method: 'pay_on_delivery',
          order_status: fulfillNow ? 'fulfilled' : 'pending',
        })
        .select('*')
        .single();
      if (error) throw new Error(JSON.stringify(error));

      // Billable delivery: goods are already on-site, so stock them in
      // right away — by product_id, no name matching needed here.
      let stocked = 0;
      if (fulfillNow) {
        for (const item of orderItems) {
          try {
            await applyStockChange(retailerId, item.product_id, item.quantity,
              `Delivered via ${order.order_number} (added by admin)`, actor.id);
            stocked += 1;
          } catch (e) {
            console.error(`[stock] failed to stock-in ${item.product} for ${order.order_number}:`, e.message);
          }
        }
      }

      await logAudit(actor.id, 'wholesale_order_created_by_admin', {
        order_id: order.id, order_number: order.order_number, retailer_id: retailerId,
        business_name: retailer.business_name, total, mark_fulfilled: fulfillNow,
        stocked_items: stocked, note: note ? String(note).trim().slice(0, 500) : null,
      });

      if (isValidEmail(retailer.email)) {
        try {
          const itemsText = orderItems.map((i) => `- ${i.quantity} x ${i.product} — ${i.variant} @ $${i.wholesale_price.toFixed(2)}`).join('\n');
          const subject = fulfillNow
            ? `Delivery added to your Ruby FoodHub account — ${order.order_number} — payment due`
            : `A new order was added to your Ruby FoodHub account — ${order.order_number}`;
          const intro = fulfillNow
            ? 'Our team has recorded a delivery to your location. The items below have been added to your stock, and payment is now due:'
            : 'Our team has added a new wholesale order to your account:';
          const totalLine = fulfillNow
            ? `<strong>Total due: $${total.toFixed(2)}</strong>`
            : `<strong>Total: $${total.toFixed(2)}</strong> — pay on delivery`;
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: retailer.email,
            subject,
            html: `<p style="font-family:sans-serif;line-height:1.6">Hi ${retailer.business_name},<br><br>` +
              `${intro}<br><br>` +
              `<strong>Order ${order.order_number}</strong><br>${itemsText.replace(/\n/g, '<br>')}<br><br>` +
              `${totalLine}<br><br>` +
              `You can pay online anytime from your <a href="https://www.rubyfoodhub.com/retailer">Ruby FoodHub retailer portal</a>, or pay our team on delivery.</p>` + RETAILER_EMAIL_FOOTER,
          });
        } catch (e) {
          console.error('order-added notification failed:', e.message);
        }
      }

      return res.status(200).json({ success: true, order, stockedItems: stocked });
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

      const { data: before, error: beforeErr } = await supabase
        .from('wholesale_orders')
        .select('order_number, order_status, retailer_id, items')
        .eq('id', orderId)
        .maybeSingle();
      if (beforeErr) throw new Error(JSON.stringify(beforeErr));
      if (!before) return res.status(404).json({ error: 'Order not found.' });
      if (before.order_status === 'canceled') return res.status(400).json({ error: 'Order has been canceled.' });

      const { error } = await supabase
        .from('wholesale_orders')
        .update({ order_status: status })
        .eq('id', orderId);
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(actor.id, 'wholesale_order_status_change', { order_id: orderId, order_number: before.order_number, status });

      // Fulfilling an order stocks the retailer's location automatically —
      // one movement per line item, attributed to the acting admin. Only on
      // the first transition into 'fulfilled' so re-saves can't double-add.
      let stocked = 0;
      if (status === 'fulfilled' && before.order_status !== 'fulfilled') {
        const { data: catalog } = await supabase.from('products').select('id, name, variant');
        const byNameVariant = new Map((catalog || []).map((p) => [`${p.name}::${p.variant}`, p.id]));
        for (const item of (Array.isArray(before.items) ? before.items : [])) {
          // Newer orders store the product_id directly; fall back to
          // name+variant matching for orders created before that.
          const productId = item.product_id || byNameVariant.get(`${item.product}::${item.variant}`);
          if (!productId) {
            console.error(`[stock] no product match for "${item.product} — ${item.variant}" on ${before.order_number}; skipped`);
            continue;
          }
          try {
            await applyStockChange(before.retailer_id, productId, Number(item.quantity) || 0,
              `Received via ${before.order_number} fulfillment`, actor.id);
            stocked += 1;
          } catch (e) {
            console.error(`[stock] failed to stock-in ${item.product} for ${before.order_number}:`, e.message);
          }
        }
      }

      return res.status(200).json({ success: true, stockedItems: stocked });
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

    if (action === 'stock-get') {
      const { retailerId } = req.body;
      if (!retailerId) return res.status(400).json({ error: 'retailerId required.' });
      const [{ data: stock, error: sErr }, { data: movements, error: mErr }] = await Promise.all([
        supabase.from('retailer_stock')
          .select('product_id, quantity, updated_at, products(name, variant)')
          .eq('retailer_id', retailerId),
        supabase.from('stock_movements')
          .select('change, note, created_at, products(name, variant), admin_users(name)')
          .eq('retailer_id', retailerId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (sErr) throw new Error(JSON.stringify(sErr));
      if (mErr) throw new Error(JSON.stringify(mErr));
      return res.status(200).json({ stock: stock || [], movements: movements || [] });
    }

    if (action === 'stock-adjust') {
      const { retailerId, productId, change, note } = req.body;
      const cleanChange = Math.trunc(Number(change));
      if (!retailerId || !productId || !Number.isFinite(cleanChange) || cleanChange === 0) {
        return res.status(400).json({ error: 'retailerId, productId, and a non-zero whole-number change are required.' });
      }

      const newQty = await applyStockChange(retailerId, productId, cleanChange, note, actor.id);
      await logAudit(actor.id, 'retailer_stock_adjusted', {
        retailer_id: retailerId, product_id: productId, change: cleanChange, new_quantity: newQty, note: note || null,
      });
      return res.status(200).json({ success: true, quantity: newQty });
    }

    if (action === 'stock-low') {
      // Low-stock overview (Home dashboard + Retailer Emails targeting):
      // anything at 5 or fewer, with the retailer id for filtering.
      const { data, error } = await supabase
        .from('retailer_stock')
        .select('retailer_id, quantity, retailer_accounts(business_name), products(name, variant)')
        .lte('quantity', 5);
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ low: data || [] });
    }

    if (action === 'email-history') {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, details, created_at, admin_users(name)')
        .eq('action', 'retailer_email_sent')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ history: data });
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
