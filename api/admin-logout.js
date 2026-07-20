const { requireSession, destroySession, logAudit } = require('./_lib/admin-auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body || {};
  const user = await requireSession(token);
  await destroySession(token);
  if (user) await logAudit(user.id, 'admin_logout', {});

  res.status(200).json({ success: true });
};
