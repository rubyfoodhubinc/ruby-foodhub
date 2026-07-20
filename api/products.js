const { supabase } = require('./_lib/supabase');

// Public storefront catalog: active products only.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .select('slug, name, variant, price')
      .eq('active', true)
      .order('slug')
      .order('price');

    if (error) throw new Error(JSON.stringify(error));

    // Short cache so admin price changes appear on the storefront within a minute.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.status(200).json({ products: data });
  } catch (err) {
    console.error('products error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
