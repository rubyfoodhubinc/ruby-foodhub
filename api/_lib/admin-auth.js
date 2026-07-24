const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('./supabase');

const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;

// Compared against when an email isn't found, so login timing doesn't
// reveal whether an account exists.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZUr5hCvi0YZY0V7lxTOPXBJEK9nnMa';

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyLogin(email, password) {
  const { data: user, error } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', String(email || '').trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error(JSON.stringify(error));

  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  return ok && user ? user : null;
}

async function createSession(adminUserId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('admin_sessions')
    .insert({ token, admin_user_id: adminUserId, expires_at: expiresAt });

  if (error) throw new Error(JSON.stringify(error));
  return token;
}

// Returns the admin_users row for a valid unexpired session token, else null.
async function requireSession(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;

  const { data: session, error } = await supabase
    .from('admin_sessions')
    .select('token, expires_at, admin_users(*)')
    .eq('token', token)
    .maybeSingle();

  if (error || !session) return null;

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('admin_sessions').delete().eq('token', token);
    return null;
  }

  const user = session.admin_users || null;
  // Deactivated accounts lose access immediately, even mid-session.
  if (user && user.active === false) return null;
  return user;
}

async function destroySession(token) {
  if (!token) return;
  await supabase.from('admin_sessions').delete().eq('token', token);
}

// Best-effort by design: an audit insert failing should never break the
// action it documents. Failures are logged for the function logs instead.
async function logAudit(adminUserId, action, details) {
  try {
    const { error } = await supabase
      .from('audit_log')
      .insert({ admin_user_id: adminUserId || null, action, details: details || {} });
    if (error) throw new Error(JSON.stringify(error));
  } catch (err) {
    console.error(`[audit] failed to log "${action}":`, err.message);
  }
}

// View-only accounts may call read actions only. Sends the 403 itself and
// returns true when blocked, so callers can just `if (blockViewerWrites(...)) return;`
function blockViewerWrites(user, res, action, readActions) {
  if (!user || user.role !== 'viewer') return false;
  if (readActions && readActions.has(action)) return false;
  res.status(403).json({ error: 'This account is view-only — it can browse every screen but cannot make changes.' });
  return true;
}

module.exports = { hashPassword, verifyLogin, createSession, requireSession, destroySession, logAudit, blockViewerWrites };
