const { resend, isValidEmail, FROM_ADDRESS } = require('./_lib/resend');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, company, message } = req.body || {};

    if (!name || !isValidEmail(email) || !company || !message) {
      return res.status(400).json({ error: 'Name, a valid email, company, and a message are required.' });
    }

    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: 'sales@rubyfoodhub.com',
      replyTo: email,
      subject: `New wholesale inquiry from ${company}`,
      text: `Name: ${name}\nEmail: ${email}\nCompany: ${company}\n\nMessage:\n${message}`,
    });

    if (error) throw new Error(error.message || 'Failed to send message');

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('wholesale form error:', err.message);
    res.status(400).json({ error: err.message });
  }
};
