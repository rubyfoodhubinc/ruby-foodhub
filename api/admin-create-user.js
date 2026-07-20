const { supabase } = require('./_lib/supabase');
const { requireSession, hashPassword, logAudit } = require('./_lib/admin-auth');

// Owner-only: add a new admin account (e.g. a partner or manager).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, name, email, password, role } = req.body || {};

    const actor = await requireSession(token);
    if (!actor) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    if (actor.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can add team members.' });
    }

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanRole = role === 'owner' ? 'owner' : 'manager';
    if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'A name and valid email are required.' });
    }
    if (String(password || '').length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    }

    const password_hash = await hashPassword(password);
    const { data: created, error } = await supabase
      .from('admin_users')
      .insert({ name: cleanName, email: cleanEmail, password_hash, role: cleanRole })
      .select('id, name, email, role')
      .single();

    if (error) {
      if (String(error.code) === '23505') {
        return res.status(409).json({ error: 'An admin account with that email already exists.' });
      }
      throw new Error(JSON.stringify(error));
    }

    await logAudit(actor.id, 'admin_user_created', { email: cleanEmail, role: cleanRole, created_id: created.id });

    res.status(200).json({ success: true, user: { name: created.name, email: created.email, role: created.role } });
  } catch (err) {
    console.error('admin-create-user error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
