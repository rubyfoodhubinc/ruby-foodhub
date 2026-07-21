const { applyCors } = require('./_lib/cors');
const { supabase } = require('./_lib/supabase');
const { requireSession, hashPassword, logAudit } = require('./_lib/admin-auth');

// Owner-only admin account management: list | create | set-active.
// Replaces the earlier standalone admin-create-user endpoint.
module.exports = async (req, res) => {
  // Native app (Capacitor) requests are cross-origin; answer preflight.
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, action } = req.body || {};
  const actor = await requireSession(token);
  if (!actor) return res.status(401).json({ error: 'Session expired — please sign in again.' });
  if (actor.role !== 'owner') {
    return res.status(403).json({ error: 'Only owners can manage admin accounts.' });
  }

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('admin_users')
        .select('id, name, email, role, active, last_login_at, created_at')
        .order('created_at');
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ users: data });
    }

    if (action === 'create') {
      const { name, email, password, role } = req.body;
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
      const { data, error } = await supabase
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

      await logAudit(actor.id, 'admin_user_created', { email: cleanEmail, role: cleanRole, created_id: data.id });
      return res.status(200).json({ success: true, user: data });
    }

    if (action === 'set-active') {
      const { userId, active } = req.body;
      if (!userId || typeof active !== 'boolean') {
        return res.status(400).json({ error: 'A userId and active boolean are required.' });
      }
      if (userId === actor.id) {
        return res.status(400).json({ error: "You can't deactivate your own account." });
      }

      const { data, error } = await supabase
        .from('admin_users')
        .update({ active })
        .eq('id', userId)
        .select('id, name, email, role, active')
        .single();
      if (error) throw new Error(JSON.stringify(error));

      // Deactivation also revokes any live sessions immediately.
      if (!active) {
        await supabase.from('admin_sessions').delete().eq('admin_user_id', userId);
      }

      await logAudit(actor.id, 'admin_user_active_change', { user_id: userId, email: data.email, active });
      return res.status(200).json({ success: true, user: data });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin-users error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
