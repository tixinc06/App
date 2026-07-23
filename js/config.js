// ────────────────────────────────────────────────────────────────────────────
// Supabase connection settings.
//
// Paste your NEW Supabase project's values below. Find them in the Supabase
// dashboard under:  Project Settings → API
//   • Project URL  → SUPABASE_URL
//   • anon public key → SUPABASE_ANON
//
// The anon key is meant to live in client-side code — it is safe to expose.
// Your data is protected by Row-Level Security policies (see schema.sql), not
// by hiding this key.
// ────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL = 'https://ngocdhdglecczyiwjert.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nb2NkaGRnbGVjY3p5aXdqZXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODM4NjAsImV4cCI6MjEwMDA1OTg2MH0.DQMnV8ABIFXpcZCbz16A0oxJr-JRU0Qmt0obufWTz10';

// True once real values have been pasted in (used to show a friendly setup notice).
export const IS_CONFIGURED =
  SUPABASE_URL.startsWith('https://') && SUPABASE_ANON.length > 20;

// VAPID public key for Web Push (js/push.js). Safe to expose — it's the
// public half of the keypair; the private half lives only as a Supabase
// edge function secret and never appears in client code. Generated once;
// changing it invalidates every existing push subscription.
export const VAPID_PUBLIC = 'BNOoBTS334HYF21qB0MEA3jwj0cv2E5iPJOVhm9LgzxagIKY-D7OTtlviZPANO6zTMZRfzPcQVIm9g_AG-pLMmU';
