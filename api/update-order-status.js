const { applyCors } = require('./_lib/cors');
const { supabase } = require('./_lib/supabase');
const { requireSession, logAudit } = require('./_lib/admin-auth');

const ALLOWED_STATUSES = ['pending', 'fulfilled', 'delivered'];

module.exports = async (req, res) => {
  // Native app (Capacitor) requests are cross-origin; answer preflight.
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, orderId, status } = req.body || {};

  const user = await requireSession(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired — please sign in again.' });
  }

  if (!orderId || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'orderId and a status of pending/fulfilled/delivered are required.' });
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ order_status: status })
      .eq('order_id', orderId)
      .select('order_id, order_status');

    if (error) throw new Error(JSON.stringify(error));
    if (!data || data.length === 0) {
      return res.status(404).json({ error: `Order ${orderId} not found.` });
    }

    await logAudit(user.id, 'order_status_change', { order_id: orderId, status });

    res.status(200).json({ success: true, order: data[0] });
  } catch (err) {
    console.error('update-order-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
