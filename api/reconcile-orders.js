const crypto = require('crypto');
const Stripe = require('stripe');
const { supabase } = require('./_lib/supabase');
const { resend, FROM_ADDRESS } = require('./_lib/resend');
const { loadLineItems, buildOrderRow } = require('./_lib/orders');
const { requireSession, logAudit } = require('./_lib/admin-auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// How far back to look for paid sessions that never made it into the DB.
const LOOKBACK_DAYS = 30;

function timingSafeEq(candidate, expected) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Manual trigger from the admin page: POST with an admin session token.
  // Scheduled trigger: Vercel Cron sends GET with "Authorization: Bearer
  // <CRON_SECRET>" when the CRON_SECRET env var is set on the project.
  let actor = null;
  if (req.method === 'POST') {
    actor = await requireSession((req.body || {}).token);
    if (!actor) return res.status(401).json({ error: 'Session expired — please sign in again.' });
  } else {
    const auth = req.headers['authorization'] || '';
    if (!process.env.CRON_SECRET || !timingSafeEq(auth, `Bearer ${process.env.CRON_SECRET}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const since = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 60 * 60;

    // Auto-paginates through every checkout session in the window.
    const paidSessions = [];
    for await (const session of stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: since },
    })) {
      if (session.payment_status === 'paid') paidSessions.push(session);
    }

    if (paidSessions.length === 0) {
      return res.status(200).json({ checked: 0, backfilled: [], failed: [] });
    }

    const orderIds = paidSessions.map((s) => s.client_reference_id || s.id);
    const { data: existingRows, error: selectError } = await supabase
      .from('orders')
      .select('order_id')
      .in('order_id', orderIds);

    if (selectError) throw new Error(JSON.stringify(selectError));

    const existing = new Set((existingRows || []).map((r) => r.order_id));
    const missing = paidSessions.filter((s) => !existing.has(s.client_reference_id || s.id));

    const backfilled = [];
    const failed = [];

    for (const session of missing) {
      const orderId = session.client_reference_id || session.id;
      try {
        let items = [];
        try {
          items = await loadLineItems(stripe, session.id);
        } catch (err) {
          console.error(`[reconcile] failed to load line items for ${session.id}:`, err.message);
        }

        const row = buildOrderRow(session, items);
        const { error: upsertError } = await supabase
          .from('orders')
          .upsert(row, { onConflict: 'order_id' });

        if (upsertError) throw new Error(JSON.stringify(upsertError));

        backfilled.push({ order_id: orderId, total: row.total, order_date: row.order_date });
        console.error(`[reconcile] backfilled order ${orderId} ($${row.total})`);
      } catch (err) {
        failed.push({ order_id: orderId, error: err.message });
        console.error(`[reconcile] FAILED to backfill order ${orderId}:`, err.message);
      }
    }

    // Deliberately no customer-facing emails here — a confirmation arriving
    // days late is worse than none. Instead, alert the sales inbox that
    // orders were recovered so they can follow up manually.
    if (backfilled.length > 0) {
      const lines = backfilled
        .map((b) => `- ${b.order_id} — $${Number(b.total).toFixed(2)} (${b.order_date})`)
        .join('\n');
      try {
        const { error } = await resend.emails.send({
          from: FROM_ADDRESS,
          to: 'sales@rubyfoodhub.com',
          subject: `Reconciliation recovered ${backfilled.length} missing order(s)`,
          text: `These paid Stripe orders were missing from the database and have been backfilled:\n\n${lines}\n\nThey did NOT receive automated confirmation emails at order time — consider following up with these customers manually. Full details are in /admin.`,
        });
        if (error) throw new Error(error.message || 'send failed');
      } catch (err) {
        console.error('[reconcile] failed to send summary email:', err.message);
      }
    }

    await logAudit(actor ? actor.id : null, 'reconcile_run', {
      source: actor ? 'manual' : 'cron',
      checked: paidSessions.length,
      backfilled: backfilled.map((b) => b.order_id),
      failed: failed.map((f) => f.order_id),
    });

    res.status(200).json({
      checked: paidSessions.length,
      backfilled,
      failed,
    });
  } catch (err) {
    console.error('[reconcile] error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
