// Public, browser-safe configuration. The Supabase anon key is designed to
// be public — Row Level Security is what protects the data. This endpoint
// exists so static pages can create a Supabase client without hardcoding
// project values into the repo.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
  });
};
