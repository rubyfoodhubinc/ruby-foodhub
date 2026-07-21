const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('./supabase');

const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZUr5hCvi0YZY0V7lxTOPXBJEK9nnMa';

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyRetailerLogin(email, password) {
  const { data: account, error } = await supabase
    .from('retailer_accounts')
    .select('*')
    .eq('email', String(email || '').trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error(JSON.stringify(error));

  // A deleted (closed) account can never be signed into again. Its stored
  // hash is scrambled anyway, but reject explicitly rather than relying on
  // bcrypt's handling of a malformed hash. Still run a compare against the
  // dummy hash so timing doesn't reveal which accounts are closed.
  const usable = account && account.account_status !== 'closed' ? account : null;

  const ok = await bcrypt.compare(String(password || ''), usable ? usable.password_hash : DUMMY_HASH);
  return ok && usable ? usable : null;
}

async function createRetailerSession(retailerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('retailer_sessions')
    .insert({ token, retailer_id: retailerId, expires_at: expiresAt });

  if (error) throw new Error(JSON.stringify(error));
  return token;
}

// Returns the retailer_accounts row (any status) for a valid unexpired
// session token, else null. Callers decide what a pending/suspended
// account may do — which is almost nothing.
async function requireRetailerSession(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;

  const { data: session, error } = await supabase
    .from('retailer_sessions')
    .select('token, expires_at, retailer_accounts(*)')
    .eq('token', token)
    .maybeSingle();

  if (error || !session) return null;

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('retailer_sessions').delete().eq('token', token);
    return null;
  }

  const acct = session.retailer_accounts || null;
  // Deletion revokes sessions, but never serve a closed account regardless.
  if (acct && acct.account_status === 'closed') return null;

  return acct;
}

async function destroyRetailerSession(token) {
  if (!token) return;
  await supabase.from('retailer_sessions').delete().eq('token', token);
}

module.exports = { hashPassword, verifyRetailerLogin, createRetailerSession, requireRetailerSession, destroyRetailerSession };
