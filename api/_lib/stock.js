const { supabase } = require('./supabase');

// Applies one stock change atomically-enough for this scale: read current,
// clamp at zero, upsert, and append the ledger row. Returns the new quantity.
// Shared by the admin dashboard (adjustments, order fulfillment) and the
// retailer portal (reporting sold quantities). createdBy is an admin_users
// id, or null for system/retailer-originated changes — the note says who.
async function applyStockChange(retailerId, productId, change, note, createdBy) {
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
    .insert({ retailer_id: retailerId, product_id: productId, change, note: note || null, created_by: createdBy || null });
  if (mvErr) throw new Error(JSON.stringify(mvErr));

  return newQty;
}

module.exports = { applyStockChange };
