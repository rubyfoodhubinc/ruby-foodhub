const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Lets the success page confirm a session actually paid before showing the
// "Thank You" state. The webhook (api/webhook.js) remains the source of
// truth for order fulfillment — this endpoint is only for the on-page confirmation.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id: sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.status(200).json({
      status: session.payment_status,
      orderNumber: session.client_reference_id,
      email: session.customer_details ? session.customer_details.email : null,
      amountTotal: session.amount_total,
    });
  } catch (err) {
    console.error('checkout-session retrieve error:', err.message);
    res.status(400).json({ error: err.message });
  }
};
