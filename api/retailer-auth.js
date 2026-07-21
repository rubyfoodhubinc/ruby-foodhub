const { applyCors } = require('./_lib/cors');
const { supabase } = require('./_lib/supabase');
const { resend, isValidEmail, FROM_ADDRESS } = require('./_lib/resend');
const { logAudit } = require('./_lib/admin-auth');
const {
  hashPassword,
  verifyRetailerLogin,
  createRetailerSession,
  requireRetailerSession,
  destroyRetailerSession,
} = require('./_lib/retailer-auth');

function publicAccount(account) {
  return {
    id: account.id,
    business_name: account.business_name,
    contact_name: account.contact_name,
    email: account.email,
    phone: account.phone,
    address: account.address,
    account_status: account.account_status,
    logo_url: account.logo_url || null,
    created_at: account.created_at,
  };
}

module.exports = async (req, res) => {
  // Native app (Capacitor) requests are cross-origin; answer preflight.
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  try {
    if (action === 'signup') {
      const { businessName, contactName, email, password, phone, address } = req.body;
      const cleanBusiness = String(businessName || '').trim();
      const cleanContact = String(contactName || '').trim();
      const cleanEmail = String(email || '').trim().toLowerCase();

      if (!cleanBusiness || !cleanContact || !isValidEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Business name, contact name, and a valid email are required.' });
      }
      if (String(password || '').length < 10) {
        return res.status(400).json({ error: 'Password must be at least 10 characters.' });
      }

      const password_hash = await hashPassword(password);
      const { data: created, error } = await supabase
        .from('retailer_accounts')
        .insert({
          business_name: cleanBusiness,
          contact_name: cleanContact,
          email: cleanEmail,
          password_hash,
          phone: String(phone || '').trim() || null,
          address: String(address || '').trim() || null,
        })
        .select('*')
        .single();

      if (error) {
        if (String(error.code) === '23505') {
          return res.status(409).json({ error: 'An account with that email already exists — try signing in.' });
        }
        throw new Error(JSON.stringify(error));
      }

      await logAudit(null, 'retailer_signup', { retailer_id: created.id, business_name: cleanBusiness, email: cleanEmail });

      // Heads-up to the sales team that an approval is waiting.
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: 'sales@rubyfoodhub.com',
          subject: `New retailer signup awaiting approval: ${cleanBusiness}`,
          text: `Business: ${cleanBusiness}\nContact: ${cleanContact}\nEmail: ${cleanEmail}\nPhone: ${phone || '(none)'}\nAddress: ${address || '(none)'}\n\nApprove or reject in the admin dashboard -> Wholesale tab.`,
        });
      } catch (e) {
        console.error('retailer signup notification email failed:', e.message);
      }

      const token = await createRetailerSession(created.id);
      return res.status(200).json({ token, account: publicAccount(created) });
    }

    if (action === 'login') {
      const { email, password } = req.body;
      const account = await verifyRetailerLogin(email, password);
      if (!account) return res.status(401).json({ error: 'Invalid email or password.' });

      const token = await createRetailerSession(account.id);
      await supabase.from('retailer_accounts').update({ last_login_at: new Date().toISOString() }).eq('id', account.id);
      return res.status(200).json({ token, account: publicAccount(account) });
    }

    if (action === 'logout') {
      await destroyRetailerSession(req.body.token);
      return res.status(200).json({ success: true });
    }

    if (action === 'me') {
      const account = await requireRetailerSession(req.body.token);
      if (!account) return res.status(401).json({ error: 'Session expired — please sign in again.' });
      return res.status(200).json({ account: publicAccount(account) });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('retailer-auth error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
