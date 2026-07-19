const Stripe = require('stripe');
const { evaluateCoupon } = require('./_lib/coupons');
const { supabase } = require('./_lib/supabase');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe's minimum charge for a USD Checkout Session.
const MIN_CHARGE_CENTS = 50;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      items,
      shippingFee,
      shippingTier,
      tip,
      orderNumber,
      email,
      fullName,
      phone,
      address,
      zip,
      notes,
      termsAgreedAt,
      couponCode,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Server-side enforcement, not just a disabled button — a request that
    // bypasses the checkout page entirely shouldn't be able to skip this.
    if (!termsAgreedAt) {
      return res.status(400).json({ error: 'You must agree to the Terms of Service before placing an order.' });
    }

    // Contact/delivery details are required — mirrors the client-side
    // validation so a direct API call can't skip it either.
    const phoneDigits = String(phone || '').replace(/\D/g, '');
    if (
      !String(fullName || '').trim() ||
      !String(address || '').trim() ||
      !/^\d{5}(-\d{4})?$/.test(String(zip || '').trim()) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()) ||
      phoneDigits.length < 7
    ) {
      return res.status(400).json({ error: 'Please fill in your name, delivery address, ZIP code, email, and phone number before checkout.' });
    }

    // Computed from the same unitAmount/quantity used to build the Stripe
    // line items below, so it's authoritative rather than trusting a
    // client-supplied total — this is what gets persisted to the orders
    // table by the webhook.
    let subtotalCents = 0;

    const line_items = items.map((item) => {
      const unitAmount = Math.round(Number(item.unitPrice) * 100);
      const quantity = Math.max(1, Math.min(50, Number(item.qty) || 1));

      if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
        throw new Error(`Invalid price for ${item.productName || 'item'}`);
      }

      subtotalCents += unitAmount * quantity;

      return {
        price_data: {
          currency: 'usd',
          product_data: {
            // Note: item.image is an internal image-slot ID (e.g. "product-ginger"),
            // not a public URL, so it can't be passed as Stripe's product_data.images.
            name: item.variantLabel
              ? `${item.productName} — ${item.variantLabel}`
              : item.productName,
          },
          unit_amount: unitAmount,
        },
        quantity,
      };
    });

    const shippingAmount = Number(shippingFee) || 0;
    if (shippingAmount > 0) {
      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Delivery' },
          unit_amount: Math.round(shippingAmount * 100),
        },
        quantity: 1,
      });
    }

    const tipAmount = Number(tip) || 0;
    if (tipAmount > 0) {
      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Tip' },
          unit_amount: Math.round(tipAmount * 100),
        },
        quantity: 1,
      });
    }

    // Coupon validation happens here, server-side, against the same
    // authoritative pre-discount total used to build the line items above —
    // never trust a discount amount computed by the client. Only one code
    // can ever be applied (the frontend only ever stores a single one).
    let discountCents = 0;
    let appliedCouponCode = '';

    if (couponCode && String(couponCode).trim()) {
      const preDiscountCents = subtotalCents + Math.round(shippingAmount * 100) + Math.round(tipAmount * 100);
      const result = evaluateCoupon(couponCode, preDiscountCents);

      if (!result.valid) {
        return res.status(400).json({ error: `"${couponCode}" is not a valid coupon code.` });
      }

      // Never discount past Stripe's minimum chargeable amount.
      discountCents = Math.min(result.discountCents, Math.max(0, preDiscountCents - MIN_CHARGE_CENTS));
      appliedCouponCode = result.code;
    }

    let discounts;
    if (discountCents > 0) {
      const stripeCoupon = await stripe.coupons.create({
        amount_off: discountCents,
        currency: 'usd',
        duration: 'once',
        name: appliedCouponCode,
      });
      discounts = [{ coupon: stripeCoupon.id }];
    }

    // If the shopper is signed in, the page sends their Supabase access
    // token — verify it server-side (never trust a client-supplied user id)
    // and attach the customer ID to the order. Guests simply have no header.
    let customerId = '';
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const { data, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
        if (!authError && data && data.user) customerId = data.user.id;
      } catch (err) {
        console.error('create-checkout-session: token verification failed:', err.message);
      }
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      discounts,
      customer_email: email || undefined,
      client_reference_id: orderNumber || undefined,
      success_url: `${origin}/Checkout.dc.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/Checkout.dc.html?canceled=1`,
      metadata: {
        orderNumber: orderNumber || '',
        fullName: fullName || '',
        phone: phone || '',
        address: address || '',
        zip: zip || '',
        notes: notes || '',
        shippingTier: shippingTier || '',
        subtotal: (subtotalCents / 100).toFixed(2),
        shippingFee: shippingAmount.toFixed(2),
        tip: tipAmount.toFixed(2),
        termsAgreedAt,
        couponCode: appliedCouponCode,
        discountAmount: (discountCents / 100).toFixed(2),
        customerId,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err.message);
    res.status(400).json({ error: err.message });
  }
};
