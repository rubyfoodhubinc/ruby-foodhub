// CORS for the native mobile apps (Capacitor webviews). The apps serve
// their pages from a local origin — capacitor://localhost on iOS,
// https://localhost on Android — so their API calls are cross-origin and
// the browser engine enforces CORS. Website traffic is same-origin and
// never hits these headers.
//
// Security note: this does not weaken anything. Auth is a session token in
// the request body (never a cookie), so no ambient credentials exist for a
// hostile site to ride on, and real browsers can never spoof a
// capacitor:// page origin.
const APP_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
  'ionic://localhost',
]);

// Call first thing in a handler:  if (applyCors(req, res)) return;
// Returns true when the request was a preflight and has been answered.
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (APP_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors };
