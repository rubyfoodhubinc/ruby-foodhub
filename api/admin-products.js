const { supabase } = require('./_lib/supabase');
const { requireSession, logAudit } = require('./_lib/admin-auth');

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^ruby\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// One endpoint, multiple actions: list | create | update-price | set-active.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, action } = req.body || {};
  const actor = await requireSession(token);
  if (!actor) return res.status(401).json({ error: 'Session expired — please sign in again.' });

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('slug')
        .order('price');
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ products: data });
    }

    if (action === 'create') {
      const { name, variant, price } = req.body;
      const cleanName = String(name || '').trim();
      const cleanVariant = String(variant || '').trim();
      const cleanPrice = Number(price);
      if (!cleanName || !cleanVariant || !Number.isFinite(cleanPrice) || cleanPrice <= 0) {
        return res.status(400).json({ error: 'Name, variant, and a positive price are required.' });
      }

      const { data, error } = await supabase
        .from('products')
        .insert({ slug: slugify(cleanName), name: cleanName, variant: cleanVariant, price: cleanPrice })
        .select('*')
        .single();
      if (error) {
        if (String(error.code) === '23505') {
          return res.status(409).json({ error: 'That product + variant already exists.' });
        }
        throw new Error(JSON.stringify(error));
      }

      await logAudit(actor.id, 'product_created', { product_id: data.id, name: cleanName, variant: cleanVariant, price: cleanPrice });
      return res.status(200).json({ success: true, product: data });
    }

    if (action === 'update-price') {
      const { id, price } = req.body;
      const cleanPrice = Number(price);
      if (!id || !Number.isFinite(cleanPrice) || cleanPrice <= 0) {
        return res.status(400).json({ error: 'A product id and positive price are required.' });
      }

      const { data: before, error: beforeError } = await supabase
        .from('products').select('name, variant, price').eq('id', id).maybeSingle();
      if (beforeError) throw new Error(JSON.stringify(beforeError));
      if (!before) return res.status(404).json({ error: 'Product not found.' });

      const { data, error } = await supabase
        .from('products')
        .update({ price: cleanPrice, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(actor.id, 'product_price_change', {
        product_id: id, name: before.name, variant: before.variant,
        old_price: Number(before.price), new_price: cleanPrice,
      });
      return res.status(200).json({ success: true, product: data });
    }

    if (action === 'set-active') {
      const { id, active } = req.body;
      if (!id || typeof active !== 'boolean') {
        return res.status(400).json({ error: 'A product id and active boolean are required.' });
      }

      const { data, error } = await supabase
        .from('products')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(JSON.stringify(error));

      await logAudit(actor.id, 'product_active_change', { product_id: id, name: data.name, variant: data.variant, active });
      return res.status(200).json({ success: true, product: data });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin-products error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
