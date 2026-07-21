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

// Wholesale order numbers are retailer-scoped and human-readable: the first
// four letters of the business name + the order date (MMDDYYYY, US Eastern) +
// a per-retailer serial. MoneyMart's fifth order on 12-24-2026 becomes
// MONE12242026-05. Older WHS-###### numbers stay valid — the DB trigger that
// produced them still exists as a fallback when no number is supplied.
function orderNumberFor(businessName, priorOrderCount, when = new Date()) {
  const letters = String(businessName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = (letters + 'XXXX').slice(0, 4);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric',
  }).formatToParts(when);
  const part = (type) => parts.find((p) => p.type === type).value;
  const serial = String(priorOrderCount + 1).padStart(2, '0');
  return `${prefix}${part('month')}${part('day')}${part('year')}-${serial}`;
}

// Insert a wholesale order under a generated number. The serial is the
// retailer's lifetime order count + 1; order_number is unique, so if two
// orders land at once the insert retries with the next serial.
async function insertWholesaleOrder(row, businessName) {
  const { count, error: cErr } = await supabase
    .from('wholesale_orders')
    .select('id', { count: 'exact', head: true })
    .eq('retailer_id', row.retailer_id);
  if (cErr) throw new Error(JSON.stringify(cErr));

  const prior = count || 0;
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('wholesale_orders')
      .insert({ ...row, order_number: orderNumberFor(businessName, prior + attempt) })
      .select('*')
      .single();
    if (!error) return data;
    lastError = error;
    if (error.code !== '23505') break;
  }
  throw new Error(JSON.stringify(lastError));
}

module.exports = { wholesaleCatalog, orderNumberFor, insertWholesaleOrder };
