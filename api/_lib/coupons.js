// Authoritative coupon rules — this is what actually determines the Stripe
// charge. Keep in sync with evaluateCoupon() in cart-lib.js, which is only
// used for the client-side preview before redirecting to Stripe.
//
// Only one coupon can ever be applied per order: the frontend only ever
// stores a single code (applying a new one overwrites it), and this
// function itself only ever evaluates one code at a time.
function evaluateCoupon(code, amountBeforeDiscountCents) {
  const normalized = String(code || '').trim().toUpperCase();

  if (normalized === 'WELCOME5') {
    return { valid: true, code: normalized, discountCents: Math.min(500, amountBeforeDiscountCents) };
  }
  if (normalized === 'TAKEOFF20') {
    return { valid: true, code: normalized, discountCents: Math.min(2000, amountBeforeDiscountCents) };
  }
  if (normalized === 'WILLDOPSY') {
    return { valid: true, code: normalized, discountCents: Math.max(0, amountBeforeDiscountCents - 100) };
  }

  return { valid: false, code: normalized, discountCents: 0 };
}

module.exports = { evaluateCoupon };
