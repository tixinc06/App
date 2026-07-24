// Weight unit display/input conversion. Every weight is ALWAYS stored in kg
// in the database — this module only converts what's shown and what's
// parsed from a form, never what's persisted, so switching units can never
// corrupt or silently rescale existing data.
import { sb } from './supabase.js';
import { getUid } from './auth.js';

const LB_PER_KG = 2.2046226218;

let currentUnit = 'kg'; // 'kg' | 'lb' — module state, like js/theme.js's applied theme

export function weightUnit() {
  return currentUnit;
}

// Called once at boot (js/app.js), right after session resolves — mirrors
// js/theme.js's loadAndApplyTheme() pattern. Falls back to kg on any failure
// (e.g. the migration hasn't been run yet).
export async function loadWeightUnit() {
  try {
    const { data } = await sb.from('user_settings').select('weight_unit').eq('user_id', getUid()).maybeSingle();
    currentUnit = data?.weight_unit === 'lb' ? 'lb' : 'kg';
  } catch {
    currentUnit = 'kg';
  }
  return currentUnit;
}

export async function saveWeightUnit(unit) {
  const next = unit === 'lb' ? 'lb' : 'kg';
  const { error } = await sb.from('user_settings').upsert({ user_id: getUid(), weight_unit: next }, { onConflict: 'user_id' });
  if (error) throw error;
  currentUnit = next;
}

// kg (however stored/computed) -> a plain number in the display unit.
export function kgToDisplay(kg) {
  const v = Number(kg) || 0;
  return currentUnit === 'lb' ? v * LB_PER_KG : v;
}

// A number typed in the display unit -> kg, for writing back to the DB.
export function displayToKg(v) {
  const n = Number(v) || 0;
  return currentUnit === 'lb' ? n / LB_PER_KG : n;
}

// A formatted "82.5 kg" / "181.9 lb" string from a kg value.
export function fmtWeight(kg, decimals = 1) {
  const v = kgToDisplay(kg);
  return `${v.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${currentUnit}`;
}

export function weightStep() {
  return currentUnit === 'lb' ? 1 : 0.5;
}

export function defaultBarWeight() {
  return currentUnit === 'lb' ? 45 : 20;
}

// Sensible default plate set in the current display unit (js/platecalc.js).
export function defaultPlateSet() {
  return currentUnit === 'lb' ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
}
