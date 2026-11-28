"use strict";
// Public client configuration. The anon key is public by design (RLS protects data).
// NEVER add the service role key here.
exports.handler = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { statusCode: 503, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "NOT_CONFIGURED" }) };
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    body: JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key, paypalClientId: process.env.PAYPAL_CLIENT_ID || null }), // client id is public by design; the secret never leaves the server
  };
};
