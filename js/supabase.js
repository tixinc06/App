// Creates the single shared Supabase client used across the app.
// The library is loaded globally from a CDN <script> in index.html, so it is
// available here as window.supabase.
import { SUPABASE_URL, SUPABASE_ANON, IS_CONFIGURED } from './config.js';

export const sb = IS_CONFIGURED
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;
