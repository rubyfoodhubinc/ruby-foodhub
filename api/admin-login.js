const { applyCors } = require('./_lib/cors');
const { supabase } = require('./_lib/supabase');
const { verifyLogin, createSession, logAudit } = require('./_lib/admin-auth');

module.exports = async (req, res) => {
  // Native app (Capacitor) requests are cross-origin; answer preflight.
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body || {};

    // First-run bootstrap: if no admin accounts exist yet, tell the UI to
    // show the setup form instead of rejecting the login.
    const { count, error: countError } = await supabase
      .from('admin_users')
      .select('*', { count: 'exact', head: true });
    if (countError) throw new Error(JSON.stringify(countError));
    if (count === 0) {
      return res.status(200).json({ needsSetup: true });
    }

    const user = await verifyLogin(email, password);
    if (!user || user.active === false) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = await createSession(user.id);
    await supabase.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
    await logAudit(user.id, 'admin_login', { email: user.email });

    res.status(200).json({ token, name: user.name, role: user.role });
  } catch (err) {
    console.error('admin-login error:', err.message);
    res.status(500).json({ error: 'Login failed — check the orders tables exist (run supabase/005).' });
  }
};
