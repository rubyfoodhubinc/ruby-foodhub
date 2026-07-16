const { resend, getOrCreateAudienceId, isValidEmail } = require('./_lib/resend');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const audienceId = await getOrCreateAudienceId();

    const { error } = await resend.contacts.create({ audienceId, email });
    if (error) throw new Error(error.message || 'Failed to subscribe');

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('newsletter signup error:', err.message);
    res.status(400).json({ error: err.message });
  }
};
