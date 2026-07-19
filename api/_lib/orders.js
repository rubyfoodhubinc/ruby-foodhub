// Shared order logic used by both api/webhook.js (live path) and
// api/reconcile-orders.js (backfill path), so both write byte-identical
// rows to the Supabase orders table.

// "Delivery" and "Tip" are synthetic line items added in
// create-checkout-session.js to get them onto the Stripe invoice — they
// aren't products.
const NON_PRODUCT_LINE_NAMES = new Set(['Delivery', 'Tip']);

async function loadLineItems(stripe, sessionId) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
  return lineItems.data.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    amount: li.amount_total / 100,
  }));
}

function buildOrderRow(session, items) {
  const orderNumber = session.client_reference_id || session.id;
  const meta = session.metadata || {};
  const customerEmail = (session.customer_details && session.customer_details.email) || null;

  return {
    order_id: orderNumber,
    order_date: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    customer_name: meta.fullName || null,
    email: customerEmail,
    phone: meta.phone || null,
    address: meta.address || null,
    zip: meta.zip || null,
    shipping_tier: meta.shippingTier || null,
    notes: meta.notes || null,
    items,
    subtotal: meta.subtotal ? Number(meta.subtotal) : null,
    shipping: meta.shippingFee ? Number(meta.shippingFee) : null,
    tip: meta.tip ? Number(meta.tip) : null,
    total: (session.amount_total || 0) / 100,
    terms_agreed_at: meta.termsAgreedAt || null,
    coupon_code: meta.couponCode || null,
    discount: meta.discountAmount ? Number(meta.discountAmount) : null,
  };
}

module.exports = { NON_PRODUCT_LINE_NAMES, loadLineItems, buildOrderRow };
