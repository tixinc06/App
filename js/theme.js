// App-wide theme engine: swaps the core CSS custom properties (including the
// RGB-triplet vars the background glow/aurora effects read) so an equipped
// theme genuinely recolours the whole app, not just a few accents.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { SHOP_ITEMS } from './gamedata.js';

function themeByCode(code) {
  return SHOP_ITEMS.themes.find(t => t.code === code) || SHOP_ITEMS.themes[0];
}

function hexToRgbString(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

// Apply a theme's colours to :root immediately. Purely visual, synchronous.
export function applyTheme(code) {
  const theme = themeByCode(code);
  const root = document.documentElement.style;
  root.setProperty('--primary', theme.colors.primary);
  root.setProperty('--primary-soft', theme.colors.primarySoft);
  root.setProperty('--bg', theme.colors.bg);
  root.setProperty('--bg2', theme.colors.bg2);
  root.setProperty('--primary-rgb', hexToRgbString(theme.colors.primary));
  root.setProperty('--accent2-rgb', hexToRgbString(theme.colors.accent2));
}

// Load the signed-in user's equipped theme and apply it. Called once at app
// boot (after session is confirmed) — falls back to default on any failure
// (e.g. the migration for user_settings hasn't been run yet).
export async function loadAndApplyTheme() {
  try {
    const uid = getUid();
    const { data } = await sb.from('user_settings').select('equipped_theme').eq('user_id', uid).maybeSingle();
    applyTheme(data?.equipped_theme || 'default');
  } catch {
    applyTheme('default');
  }
}
