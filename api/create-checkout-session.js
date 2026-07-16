const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      items,
      shippingFee,
      tip,
      orderNumber,
      email,
      fullName,
      phone,
      address,
      zip,
      notes,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const line_items = items.map((item) => {
      const unitAmount = Math.round(Number(item.unitPrice) * 100);
      const quantity = Math.max(1, Math.min(50, Number(item.qty) || 1));

      if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
        throw new Error(`Invalid price for ${item.productName || 'item'}`);
      }

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

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
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
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err.message);
    res.status(400).json({ error: err.message });
  }
};
