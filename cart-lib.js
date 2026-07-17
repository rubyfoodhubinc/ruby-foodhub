// Shared cart/shipping logic for Ruby FoodHub. Plain ES module — import via dynamic import() from DC logic classes.

// Editable zip -> distance-tier lookup. Add more Houston-area zips here as needed.
// Tiers: '0-20' (0-20mi), '20-50' (20-50mi), '50+' (everything else / not found).
export const ZIP_TIER_TABLE = {
  '77002': '0-20', '77003': '0-20', '77004': '0-20', '77005': '0-20',
  '77006': '0-20', '77007': '0-20', '77008': '0-20', '77009': '0-20',
  '77019': '0-20', '77025': '0-20', '77401': '0-20', '77444': '0-20',
  '77450': '20-50', '77449': '20-50', '77494': '20-50', '77479': '20-50',
  '77406': '20-50', '77083': '20-50', '77084': '20-50', '77471': '20-50'
};

export function getTierForZip(zip) {
  return ZIP_TIER_TABLE[String(zip || '').trim()] || '50+';
}

// Flat delivery fee regardless of distance tier or subtotal. The tier is
// still computed (see getTierForZip above) and stored with the order for
// logistics/planning purposes, it just no longer affects the price.
const FLAT_SHIPPING_FEE = 14.99;

export function computeShippingFee() {
  return FLAT_SHIPPING_FEE;
}

const CART_KEY = 'rubyfoodhub_cart_v1';

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch (e) { return []; }
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('cart:updated'));
  return items;
}

export function addToCart({ productSlug, productName, variantLabel, unitPrice, qty, image }) {
  const items = getCart();
  const id = productSlug + '::' + variantLabel;
  const existing = items.find((i) => i.id === id);
  if (existing) existing.qty += qty;
  else items.push({ id, productSlug, productName, variantLabel, unitPrice, qty, image });
  return saveCart(items);
}

export function updateQty(id, qty) {
  const items = getCart();
  const it = items.find((i) => i.id === id);
  if (it) it.qty = Math.max(1, qty);
  return saveCart(items);
}

export function removeItem(id) {
  return saveCart(getCart().filter((i) => i.id !== id));
}

export function getCartCount() {
  return getCart().reduce((n, i) => n + i.qty, 0);
}

export function getSubtotal() {
  return getCart().reduce((s, i) => s + i.unitPrice * i.qty, 0);
}

// Sequential order numbers: RFH + a 13-digit zero-padded serial (e.g. RFH0000000000001).
const ORDER_SEQ_KEY = 'rubyfoodhub_order_seq';

export function getNextOrderNumber() {
  const next = (parseInt(localStorage.getItem(ORDER_SEQ_KEY), 10) || 0) + 1;
  localStorage.setItem(ORDER_SEQ_KEY, String(next));
  return 'RFH' + String(next).padStart(13, '0');
}

// Only one coupon is ever stored — applying a new code overwrites it, there's
// no concept of stacking multiple codes.
const COUPON_KEY = 'rubyfoodhub_coupon_v1';

export function getCoupon() {
  return localStorage.getItem(COUPON_KEY) || '';
}

export function setCoupon(code) {
  localStorage.setItem(COUPON_KEY, code);
  window.dispatchEvent(new CustomEvent('cart:updated'));
}

export function clearCoupon() {
  localStorage.removeItem(COUPON_KEY);
  window.dispatchEvent(new CustomEvent('cart:updated'));
}

// Client-side preview only, so the customer sees the discount before
// redirecting to Stripe. The authoritative copy that actually determines
// the charge lives server-side in api/_lib/coupons.js — keep both in sync.
export function evaluateCoupon(code, amountBeforeDiscount) {
  const normalized = String(code || '').trim().toUpperCase();

  if (normalized === 'WELCOME5') {
    return { valid: true, code: normalized, discount: Math.min(5, amountBeforeDiscount) };
  }
  if (normalized === 'TAKEOFF20') {
    return { valid: true, code: normalized, discount: Math.min(20, amountBeforeDiscount) };
  }
  if (normalized === 'WILLDOPSY') {
    return { valid: true, code: normalized, discount: Math.max(0, amountBeforeDiscount - 1) };
  }
  return { valid: false, code: normalized, discount: 0 };
}
