const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { hashPassword, createSession, logAudit } = require('./_lib/admin-auth');

function timingSafeEq(candidate, expected) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// One-time bootstrap: creates the FIRST owner account. Only works while the
// admin_users table is empty, and requires the legacy shared ADMIN_PASSWORD
// as proof of ownership. After the first account exists this endpoint is
// permanently inert — additional admins are created by an owner via
// api/admin-users (action: create).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { bootstrapPassword, name, email, password } = req.body || {};

    if (!process.env.ADMIN_PASSWORD || !timingSafeEq(bootstrapPassword, process.env.ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Incorrect setup password.' });
    }

    const { count, error: countError } = await supabase
      .from('admin_users')
      .select('*', { count: 'exact', head: true });
    if (countError) throw new Error(JSON.stringify(countError));
    if (count > 0) {
      return res.status(409).json({ error: 'Setup has already been completed. Sign in instead.' });
    }

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'A name and valid email are required.' });
    }
    if (String(password || '').length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    }

    const password_hash = await hashPassword(password);
    const { data: created, error } = await supabase
      .from('admin_users')
      .insert({ name: cleanName, email: cleanEmail, password_hash, role: 'owner' })
      .select('id, name, role')
      .single();
    if (error) throw new Error(JSON.stringify(error));

    await logAudit(created.id, 'admin_user_created', { email: cleanEmail, role: 'owner', via: 'bootstrap-setup' });

    const token = await createSession(created.id);
    res.status(200).json({ token, name: created.name, role: created.role });
  } catch (err) {
    console.error('admin-setup error:', err.message);
    res.status(500).json({ error: 'Setup failed — confirm supabase/005 has been run.' });
  }
};
