// App-wide Settings: weight unit (kg/lb), currency, a link to Themes, sound
// mute, and notification reminders (food/workout/weigh-in times) — the
// reminders' actual delivery is a pg_cron job hitting the "push" edge
// function's `reminders` branch (see migration-round6.sql).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, toast, skeleton, emptyState, getCurrency, setCurrency } from './ui.js';
import { weightUnit, saveWeightUnit } from './units.js';
import { isMuted, toggleMuted } from './sound.js';

const CURRENCIES = [
  { symbol: '£', label: 'British Pound (£)' },
  { symbol: '$', label: 'US Dollar ($)' },
  { symbol: '€', label: 'Euro (€)' }
];

const REMINDER_TYPES = [
  { key: 'food', label: 'Log your food', icon: '🍽️' },
  { key: 'workout', label: 'Train today', icon: '💪' },
  { key: 'weighin', label: 'Weigh-in day', icon: '⚖️' }
];

async function loadSettings() {
  const { data, error } = await sb.from('user_settings').select('*').eq('user_id', getUid()).maybeSingle();
  if (error) throw error;
  return data || {};
}

export async function renderSettings(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(2, 'item'));
  let settings;
  try {
    settings = await loadSettings();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load settings. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  // ── Units & currency ──
  const unitSelect = el('select', {}, [
    el('option', { value: 'kg', selected: weightUnit() === 'kg' }, 'Kilograms (kg)'),
    el('option', { value: 'lb', selected: weightUnit() === 'lb' }, 'Pounds (lb)')
  ]);
  unitSelect.addEventListener('change', async () => {
    try {
      await saveWeightUnit(unitSelect.value);
      toast(`Weights now show in ${unitSelect.value}`, 'ok');
      renderSettings(container, root);
    } catch (ex) {
      toast(ex.message || 'Failed to save', 'err');
    }
  });

  const currencySelect = el('select', {}, CURRENCIES.map(c =>
    el('option', { value: c.symbol, selected: getCurrency() === c.symbol }, c.label)));
  currencySelect.addEventListener('change', async () => {
    try {
      const { error } = await sb.from('user_settings')
        .upsert({ user_id: getUid(), currency: currencySelect.value }, { onConflict: 'user_id' });
      if (error) throw error;
      setCurrency(currencySelect.value);
      toast('Currency updated', 'ok');
    } catch (ex) {
      toast(ex.message || 'Failed to save', 'err');
    }
  });

  // ── Sound ──
  const soundBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    onClick: () => {
      const muted = toggleMuted();
      soundBtn.textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
    }
  }, isMuted() ? '🔇 Sound off' : '🔊 Sound on');

  // ── Reminders ──
  const prefs = settings.reminder_prefs || {};
  const reminderState = {};
  for (const t of REMINDER_TYPES) reminderState[t.key] = { enabled: !!prefs[t.key]?.enabled, time: prefs[t.key]?.time || '18:00' };

  const reminderRows = REMINDER_TYPES.map(t => {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = reminderState[t.key].enabled;
    const timeInput = el('input', { type: 'time', value: reminderState[t.key].time, style: 'margin-top:0;width:auto' });
    timeInput.disabled = !checkbox.checked;
    checkbox.addEventListener('change', () => {
      reminderState[t.key].enabled = checkbox.checked;
      timeInput.disabled = !checkbox.checked;
    });
    timeInput.addEventListener('input', () => { reminderState[t.key].time = timeInput.value; });
    return el('div', { class: 'row', style: 'align-items:center;gap:10px;margin-bottom:10px' }, [
      checkbox,
      el('div', { class: 'grow' }, [t.icon + ' ' + t.label]),
      timeInput
    ]);
  });

  const reminderErr = el('p', { class: 'form-error', hidden: true });
  const saveRemindersBtn = el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:8px' }, 'Save reminders');
  saveRemindersBtn.addEventListener('click', async () => {
    reminderErr.hidden = true;
    saveRemindersBtn.disabled = true;
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { error } = await sb.from('user_settings').upsert({
        user_id: getUid(), reminder_prefs: reminderState, timezone
      }, { onConflict: 'user_id' });
      if (error) throw error;
      toast('Reminders saved', 'ok');
    } catch (ex) {
      reminderErr.textContent = ex.message || 'Failed to save.';
      reminderErr.hidden = false;
    } finally {
      saveRemindersBtn.disabled = false;
    }
  });

  container.append(
    el('div', { class: 'section-head' }, [el('h2', {}, 'Units & currency')]),
    el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:18px' }, [
      el('label', {}, ['Weight unit', unitSelect]),
      el('label', { style: 'margin-top:10px' }, ['Currency', currencySelect])
    ]),

    el('div', { class: 'section-head' }, [el('h2', {}, 'Appearance')]),
    el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between' }, [
      el('div', {}, 'Themes & banners'),
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => toast('Open Fitness → Shop to browse themes', '') }, '🎨 Shop')
    ]),

    el('div', { class: 'section-head' }, [el('h2', {}, 'Sound')]),
    el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:18px' }, [soundBtn]),

    el('div', { class: 'section-head' }, [el('h2', {}, 'Reminders')]),
    el('div', { class: 'card', style: 'padding:16px 18px' }, [
      ...reminderRows,
      reminderErr,
      saveRemindersBtn,
      el('div', { class: 'dim', style: 'font-size:11px;margin-top:10px' },
        'Enable push alerts first (Fitness → Profile → 🔔 Alerts) for reminders to actually arrive.')
    ])
  );
}
