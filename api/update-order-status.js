const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');

const ALLOWED_STATUSES = ['pending', 'delivered'];

function timingSafeEq(candidate, expected) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password, orderId, status } = req.body || {};

  if (!process.env.ADMIN_PASSWORD || !timingSafeEq(password, process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!orderId || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'orderId and a status of pending/delivered are required.' });
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

    res.status(200).json({ success: true, order: data[0] });
  } catch (err) {
    console.error('update-order-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
