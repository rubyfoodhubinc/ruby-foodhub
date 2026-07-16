const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`Order ${session.client_reference_id} paid — session ${session.id}`);
    // TODO: persist the order (DB/email) using session.client_reference_id
    // and session.metadata (fullName, phone, address, zip, notes).
  }

  res.status(200).json({ received: true });
}

// Vercel's default body parser would consume the stream before Stripe's
// signature check can run on the raw bytes, so it's disabled here. This
// must be attached to the exported function itself, not assigned to
// module.exports separately — a later `module.exports = fn` would
// otherwise silently discard it.
handler.config = {
  api: { bodyParser: false },
};

module.exports = handler;
