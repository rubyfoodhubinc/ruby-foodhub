const { supabase } = require('./_lib/supabase');
const { requireSession } = require('./_lib/admin-auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body || {};
  const user = await requireSession(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired — please sign in again.' });
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
