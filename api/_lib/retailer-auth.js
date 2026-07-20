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

  const ok = await bcrypt.compare(String(password || ''), account ? account.password_hash : DUMMY_HASH);
  return ok && account ? account : null;
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

  return session.retailer_accounts || null;
}

async function destroyRetailerSession(token) {
  if (!token) return;
  await supabase.from('retailer_sessions').delete().eq('token', token);
}

module.exports = { hashPassword, verifyRetailerLogin, createRetailerSession, requireRetailerSession, destroyRetailerSession };
