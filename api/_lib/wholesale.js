const { supabase } = require('./supabase');

// Only active products that HAVE a wholesale price are orderable wholesale.
// Shared by the retailer portal (placing an order) and the admin wholesale
// tab (adding an order on a retailer's behalf) so pricing logic never drifts.
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

module.exports = { wholesaleCatalog };
