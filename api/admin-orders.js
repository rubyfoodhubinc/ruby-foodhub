const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');

function isCorrectPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD || '';
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(expected);

  // timingSafeEqual throws on unequal-length buffers, so a length
  // mismatch is treated as "wrong password" up front — that's already
  // determinable from the input alone, not a timing side-channel.
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not configured' });
  }

  const { password } = req.body || {};
  if (!isCorrectPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('order_date', { ascending: false });

    if (error) throw new Error(error.message || 'Failed to load orders');

    res.status(200).json({ orders: data });
  } catch (err) {
    console.error('admin-orders error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
