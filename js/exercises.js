// Exercise library: a curated premade catalog grouped by muscle group, a
// user's own custom exercises, and a reusable autocomplete-style picker
// widget that attaches to a plain text input (used by both the workout
// builder in fitness.js and the template editor in workouts.js). Also
// exposes "recent" exercises (from workout history) and "previous
// performance" lookups (for the per-set weight×reps hint).
//
// Names for lifts that already have bodyweight-relative rank standards
// (js/standards.js) are kept identical so ranking keeps working unchanged.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, toast } from './ui.js';

export const PREMADE_EXERCISES = {
  Chest: [
    'Bench Press', 'Incline Bench Press', 'Incline Dumbbell Press', 'Decline Bench Press',
    'Dumbbell Fly', 'Cable Fly', 'Push-Up', 'Chest Dip', 'Machine Chest Press'
  ],
  Back: [
    'Deadlift', 'Barbell Row', 'Pull-Up', 'Chin-Up', 'Lat Pulldown', 'Seated Cable Row',
    'T-Bar Row', 'Face Pull', 'Single-Arm Dumbbell Row', 'Rack Pull', 'Straight-Arm Pulldown'
  ],
  Legs: [
    'Squat', 'Front Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Leg Extension',
    'Walking Lunge', 'Bulgarian Split Squat', 'Calf Raise', 'Hip Thrust', 'Goblet Squat', 'Hack Squat'
  ],
  Shoulders: [
    'Overhead Press', 'Arnold Press', 'Lateral Raise', 'Front Raise', 'Rear Delt Fly',
    'Upright Row', 'Shrug', 'Machine Shoulder Press'
  ],
  Arms: [
    'Bicep Curl', 'Hammer Curl', 'Preacher Curl', 'Triceps Pushdown', 'Skull Crusher',
    'Overhead Triceps Extension', 'Close-Grip Bench Press', 'Dip', 'Cable Curl', 'Concentration Curl'
  ],
  Core: [
    'Plank', 'Hanging Leg Raise', 'Cable Crunch', 'Russian Twist', 'Ab Wheel Rollout',
    'Sit-Up', 'Side Plank', 'Mountain Climber'
  ],
  Cardio: [
    'Running', 'Cycling', 'Rowing Machine', 'Jump Rope', 'Stair Climber', 'Elliptical'
  ]
};

let cachedCustom = null;
let cachedRecent = null;

export async function loadCustomExercises() {
  const { data, error } = await sb.from('custom_exercises').select('*').eq('user_id', getUid()).order('name');
  if (error) throw error;
  return data || [];
}

export async function saveCustomExercise(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Enter a name first.');
  const { error } = await sb.from('custom_exercises').insert({ user_id: getUid(), name: trimmed });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
  return trimmed;
}

// Unique exercise names from the user's most recent workouts, newest first.
export async function loadRecentExercises(limit = 8) {
  const { data, error } = await sb.from('workouts')
    .select('exercises').eq('user_id', getUid()).order('workout_date', { ascending: false }).limit(15);
  if (error) return [];
  const seen = new Set(); const recent = [];
  for (const w of (data || [])) {
    for (const ex of (w.exercises || [])) {
      const name = (ex.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name); recent.push(name);
      if (recent.length >= limit) return recent;
    }
  }
  return recent;
}

// Most recent prior workout containing this exercise, for the "previous"
// weight×reps hint. Searches the last 30 workouts client-side (JSONB array
// membership isn't cheaply filterable server-side without an RPC, and this
// window is more than enough for a "last time" hint).
export async function loadPreviousPerformance(exerciseName) {
  const name = (exerciseName || '').trim().toLowerCase();
  if (!name) return null;
  const { data, error } = await sb.from('workouts')
    .select('workout_date, exercises').eq('user_id', getUid())
    .order('workout_date', { ascending: false }).limit(30);
  if (error) return null;
  for (const w of (data || [])) {
    const ex = (w.exercises || []).find(e => (e.name || '').trim().toLowerCase() === name);
    if (ex && ex.sets?.length) return { date: w.workout_date, sets: ex.sets };
  }
  return null;
}

async function loadPickerData() {
  if (cachedCustom && cachedRecent) return { custom: cachedCustom, recent: cachedRecent };
  const [custom, recent] = await Promise.all([
    loadCustomExercises().catch(() => []),
    loadRecentExercises().catch(() => [])
  ]);
  cachedCustom = custom; cachedRecent = recent;
  return { custom, recent };
}

// Attaches a search-as-you-type dropdown to an existing text input (search +
// muscle-group chips + recents + a "save as custom" option). Renders the
// dropdown as an absolutely-positioned sibling of the input, anchored to the
// input's parent (made position:relative on demand).
//
// Dropdown creation is deferred to first focus/input rather than done here —
// call sites often build the input before it has a parent (e.g. before
// wrapping it into a card), and insertAdjacentElement silently no-ops on a
// parentless node. By first focus the input is always attached (the modal
// containing it is already open), so this is robust regardless of the
// caller's construction order.
export function attachExercisePicker(input) {
  let dropdown = null;
  function ensureDropdown() {
    if (dropdown) return dropdown;
    dropdown = el('div', { class: 'exercise-dropdown', hidden: true });
    input.insertAdjacentElement('afterend', dropdown);
    if (input.parentElement) input.parentElement.style.position = 'relative';
    return dropdown;
  }

  let activeGroup = null;
  // Guards against a race: dispatching 'input' below re-triggers this same
  // module's own render() listener asynchronously (it awaits loadPickerData
  // before touching `dropdown.hidden`), which would reopen the dropdown
  // AFTER we just closed it here. render() bails out immediately while this
  // is true, before it ever reaches its first await.
  let selecting = false;

  function selectExercise(name) {
    selecting = true;
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ensureDropdown().hidden = true;
    activeGroup = null;
    selecting = false;
  }

  async function render() {
    if (selecting) return;
    const dropdown = ensureDropdown();
    const { custom, recent } = await loadPickerData();
    const query = input.value.trim().toLowerCase();
    dropdown.innerHTML = '';

    const allPremade = Object.entries(PREMADE_EXERCISES).flatMap(([group, names]) => names.map(name => ({ name, group })));
    const allCustom = custom.map(c => ({ name: c.name, group: 'Custom' }));
    const all = [...allPremade, ...allCustom];

    let results;
    if (query) {
      results = all.filter(x => x.name.toLowerCase().includes(query)).slice(0, 12);
    } else if (activeGroup) {
      results = all.filter(x => x.group === activeGroup);
    } else {
      results = recent.map(name => ({ name, group: 'Recent' }));
    }

    if (!query && !activeGroup) {
      dropdown.append(el('div', { class: 'ex-chip-row' },
        Object.keys(PREMADE_EXERCISES).map(g => el('button', {
          type: 'button', class: 'ex-chip',
          onMousedown: e => { e.preventDefault(); activeGroup = g; render(); }
        }, g))));
    } else if (activeGroup) {
      dropdown.append(el('div', { class: 'ex-chip-row' }, [
        el('button', {
          type: 'button', class: 'ex-chip active',
          onMousedown: e => { e.preventDefault(); activeGroup = null; render(); }
        }, activeGroup + ' ✕')
      ]));
    }

    if (!results.length && !query) {
      dropdown.append(el('div', { class: 'ex-empty' }, 'Type to search, or pick a muscle group above.'));
    }

    for (const r of results) {
      dropdown.append(el('div', {
        class: 'ex-option',
        onMousedown: e => { e.preventDefault(); selectExercise(r.name); }
      }, [
        el('span', {}, r.name),
        el('span', { class: 'ex-group-tag' }, r.group)
      ]));
    }

    if (query) {
      const exactMatch = all.some(x => x.name.toLowerCase() === query);
      if (!exactMatch) {
        dropdown.append(el('div', {
          class: 'ex-option ex-save-custom',
          onMousedown: async e => {
            e.preventDefault();
            try {
              const saved = await saveCustomExercise(input.value);
              cachedCustom = null; cachedRecent = null; // refetch next open — includes the new one
              selectExercise(saved);
              toast('Saved as a custom exercise', 'ok');
            } catch (ex) {
              toast(ex.message || 'Failed to save', 'err');
            }
          }
        }, `＋ Save "${input.value.trim()}" as custom`));
      }
    }

    dropdown.hidden = false;
  }

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('blur', () => { setTimeout(() => { if (dropdown) dropdown.hidden = true; }, 150); });
}
