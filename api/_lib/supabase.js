const { createClient } = require('@supabase/supabase-js');

// Service role key bypasses Row Level Security — this client must only ever
// be used from serverless functions, never sent to the browser.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = { supabase };
