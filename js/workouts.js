// Custom workout templates + splits: build your own workouts (e.g. "Push day"),
// schedule them across the week as a named split, and see/start today's planned
// workout from a "Today" card. Also ships a small preset-split library so a new
// user can get going in one tap.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, toast, formModal, confirmModal, actionSheet, emptyState, skeleton, closeModal, openModal
} from './ui.js';
import { workoutBuilder } from './fitness.js';
import { attachExercisePicker } from './exercises.js';

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PRESETS = [
  {
    key: 'ppl', label: 'Push / Pull / Legs', sub: '6-day split',
    templates: {
      'Push': [
        { name: 'Bench Press', sets: 4, reps: 8 },
        { name: 'Overhead Press', sets: 3, reps: 10 },
        { name: 'Incline Dumbbell Press', sets: 3, reps: 10 },
        { name: 'Triceps Pushdown', sets: 3, reps: 12 },
        { name: 'Lateral Raise', sets: 3, reps: 15 }
      ],
      'Pull': [
        { name: 'Deadlift', sets: 3, reps: 5 },
        { name: 'Barbell Row', sets: 4, reps: 8 },
        { name: 'Lat Pulldown', sets: 3, reps: 10 },
        { name: 'Face Pull', sets: 3, reps: 15 },
        { name: 'Bicep Curl', sets: 3, reps: 12 }
      ],
      'Legs': [
        { name: 'Squat', sets: 4, reps: 8 },
        { name: 'Romanian Deadlift', sets: 3, reps: 10 },
        { name: 'Leg Press', sets: 3, reps: 12 },
        { name: 'Leg Curl', sets: 3, reps: 12 },
        { name: 'Calf Raise', sets: 4, reps: 15 }
      ]
    },
    schedule: [null, 'Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'] // Sun..Sat
  },
  {
    key: 'ul', label: 'Upper / Lower', sub: '4-day split',
    templates: {
      'Upper': [
        { name: 'Bench Press', sets: 4, reps: 8 },
        { name: 'Barbell Row', sets: 4, reps: 8 },
        { name: 'Overhead Press', sets: 3, reps: 10 },
        { name: 'Lat Pulldown', sets: 3, reps: 10 },
        { name: 'Bicep Curl', sets: 3, reps: 12 },
        { name: 'Triceps Pushdown', sets: 3, reps: 12 }
      ],
      'Lower': [
        { name: 'Squat', sets: 4, reps: 8 },
        { name: 'Romanian Deadlift', sets: 3, reps: 10 },
        { name: 'Leg Press', sets: 3, reps: 12 },
        { name: 'Leg Curl', sets: 3, reps: 12 },
        { name: 'Calf Raise', sets: 4, reps: 15 }
      ]
    },
    schedule: [null, 'Upper', 'Lower', null, 'Upper', 'Lower', null]
  },
  {
    key: 'fb', label: 'Full Body', sub: '3-day split',
    templates: {
      'Full Body': [
        { name: 'Squat', sets: 3, reps: 8 },
        { name: 'Bench Press', sets: 3, reps: 8 },
        { name: 'Barbell Row', sets: 3, reps: 8 },
        { name: 'Overhead Press', sets: 3, reps: 8 },
        { name: 'Deadlift', sets: 2, reps: 5 }
      ]
    },
    schedule: [null, 'Full Body', null, 'Full Body', null, 'Full Body', null]
  }
];

// Explicit user_id filters below are load-bearing, not redundant: since Phase
// FG-5 added a friends-visibility RLS policy to workout_templates (so a friend
// can see your shared plans), an unfiltered select here would also return
// templates friends have shared with YOU, mixing them into your own planner.
async function loadPlanner() {
  const uid = getUid();
  const [templates, splits] = await Promise.all([
    sb.from('workout_templates').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    sb.from('splits').select('*').eq('user_id', uid).order('created_at', { ascending: false })
  ]);
  if (templates.error) throw templates.error;
  if (splits.error) throw splits.error;
  return { templates: templates.data || [], splits: splits.data || [] };
}

// `container` is the sub-section this module owns inside the Fitness view;
// `root` is the true page root, needed so workoutBuilder's save can trigger a
// full Fitness-tab refresh (it only knows how to refresh the whole page).
export async function renderTrain(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(2, 'item'));
  let data;
  try {
    data = await loadPlanner();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load your planner. ' + (ex.message || '')));
    return;
  }
  const { templates, splits } = data;
  container.innerHTML = '';

  const activeSplit = splits.find(s => s.is_active);
  container.append(todayCard(activeSplit, templates, container, root));

  container.append(el('div', { class: 'row', style: 'margin-bottom:22px' }, [
    el('button', { class: 'btn', onClick: () => manageTemplates(templates, container, root) }, `📋 Templates (${templates.length})`),
    el('button', { class: 'btn', onClick: () => manageSplits(splits, templates, container, root) }, `🗓️ Splits (${splits.length})`)
  ]));
}

function todayCard(activeSplit, templates, container, root) {
  if (!activeSplit) {
    return el('div', { class: 'card', style: 'padding:18px;margin-bottom:20px' }, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, "Today's plan"),
      el('div', { style: 'margin-top:8px;color:var(--muted)' }, 'No active split yet — set one up to see your plan here.'),
      el('button', {
        class: 'btn btn-primary btn-sm', style: 'margin-top:10px',
        onClick: () => presetPicker(container, root)
      }, '⚡ Quick-start a split')
    ]);
  }

  const dow = new Date().getDay();
  const templateId = activeSplit.schedule?.[String(dow)];
  const template = templateId ? templates.find(t => t.id === templateId) : null;

  return el('div', { class: 'card', style: 'padding:18px;margin-bottom:20px' }, [
    el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' },
      "Today's plan · " + activeSplit.name),
    template
      ? el('div', {}, [
          el('div', { style: 'font-size:20px;font-weight:800;margin-top:6px' }, template.name),
          el('div', { class: 'dim', style: 'font-size:13px;margin-top:2px' },
            `${(template.exercises || []).length} exercise${(template.exercises || []).length === 1 ? '' : 's'}`),
          el('button', {
            class: 'btn btn-primary btn-block', style: 'margin-top:12px',
            onClick: () => workoutBuilder(root, { name: template.name, exercises: template.exercises })
          }, '▶ Start workout')
        ])
      : el('div', { style: 'margin-top:8px;color:var(--muted)' }, '😌 Rest day')
  ]);
}

// ── Templates ─────────────────────────────────────────────────────────────
function manageTemplates(templates, container, root) {
  actionSheet('Workout templates', [
    { label: '＋ New template', primary: true, onClick: () => templateEditorModal(container, root, null) },
    { label: '⚡ Use a preset', onClick: () => presetPicker(container, root) },
    ...templates.map(t => ({
      label: `${t.name} (${(t.exercises || []).length} exercises)`,
      onClick: () => templateActions(t, container, root)
    }))
  ]);
}

function templateActions(t, container, root) {
  actionSheet(t.name, [
    { label: '▶ Start workout', primary: true, onClick: () => workoutBuilder(root, { name: t.name, exercises: t.exercises }) },
    { label: '✏️ Edit', onClick: () => templateEditorModal(container, root, t) },
    { label: t.is_shared ? '🔒 Unshare with friends' : '🔗 Share with friends', onClick: () => toggleShare(t, container, root) },
    { label: '🗑️ Delete', danger: true, onClick: () => deleteTemplate(t, container, root) }
  ]);
}

async function toggleShare(t, container, root) {
  try {
    const { error } = await sb.from('workout_templates').update({ is_shared: !t.is_shared }).eq('id', t.id);
    if (error) throw error;
    toast(t.is_shared ? 'Unshared' : 'Shared with friends 🔗', 'ok');
    renderTrain(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to update sharing', 'err');
  }
}

function templateEditorModal(container, root, existing) {
  const exWrap = el('div');
  const rows = [];

  function addRow(name = '', sets = 3, reps = 10) {
    const nameInput = el('input', { placeholder: 'Exercise name', value: name, style: 'margin-top:0' });
    attachExercisePicker(nameInput);
    const setsInput = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '1', placeholder: 'sets', value: sets, style: 'margin-top:0' });
    const repsInput = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '1', placeholder: 'reps', value: reps, style: 'margin-top:0' });
    const rowObj = { nameInput, setsInput, repsInput };
    const node = el('div', { class: 'card', style: 'padding:12px;margin-bottom:10px' }, [
      nameInput,
      el('div', { class: 'row', style: 'margin-top:8px;align-items:center' }, [
        setsInput, repsInput,
        el('button', {
          type: 'button', class: 'btn btn-sm btn-danger', style: 'flex:0 0 auto',
          onClick: () => { const i = rows.indexOf(rowObj); if (i > -1) rows.splice(i, 1); node.remove(); }
        }, '🗑')
      ])
    ]);
    rows.push(rowObj);
    exWrap.append(node);
  }

  if (existing?.exercises?.length) { for (const e of existing.exercises) addRow(e.name, e.sets, e.reps); }
  else addRow();

  const nameInput = el('input', { placeholder: 'e.g. Push day', value: existing?.name || '', style: 'margin-top:0' });
  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, existing ? 'Save changes' : 'Save template');

  saveBtn.addEventListener('click', async () => {
    const exercises = rows
      .map(r => ({ name: r.nameInput.value.trim(), sets: Number(r.setsInput.value) || 1, reps: Number(r.repsInput.value) || 1 }))
      .filter(e => e.name);
    if (!nameInput.value.trim()) { err.textContent = 'Give the template a name.'; err.hidden = false; return; }
    if (!exercises.length) { err.textContent = 'Add at least one exercise.'; err.hidden = false; return; }
    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      if (existing) {
        const { error } = await sb.from('workout_templates').update({ name: nameInput.value.trim(), exercises }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('workout_templates').insert({ user_id: getUid(), name: nameInput.value.trim(), exercises });
        if (error) throw error;
      }
      closeModal();
      toast('Template saved', 'ok');
      renderTrain(container, root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = existing ? 'Save changes' : 'Save template';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, existing ? 'Edit template' : 'New template'),
    el('label', {}, ['Template name', nameInput]),
    el('div', { class: 'section-head', style: 'margin:6px 2px 10px' }, [el('h2', {}, 'Exercises')]),
    exWrap,
    el('button', { type: 'button', class: 'btn btn-ghost btn-block', style: 'margin-bottom:14px', onClick: () => addRow() }, '＋ Add exercise'),
    err,
    saveBtn
  ]));
}

function deleteTemplate(t, container, root) {
  confirmModal({
    title: 'Delete template?',
    message: `"${t.name}" will be removed. Any split day using it will show as a rest day instead.`,
    confirmText: 'Delete',
    onConfirm: async () => {
      const { error } = await sb.from('workout_templates').delete().eq('id', t.id);
      if (error) throw error;
      toast('Deleted');
      renderTrain(container, root);
    }
  });
}

// ── Splits ────────────────────────────────────────────────────────────────
function manageSplits(splits, templates, container, root) {
  if (!templates.length) {
    actionSheet('Splits', [
      { label: '＋ Create a template first', primary: true, onClick: () => templateEditorModal(container, root, null) }
    ]);
    return;
  }
  actionSheet('Splits', [
    { label: '＋ New split', primary: true, onClick: () => splitEditorModal(container, root, null, templates) },
    { label: '⚡ Use a preset', onClick: () => presetPicker(container, root) },
    ...splits.map(s => ({
      label: s.name + (s.is_active ? ' ✓ active' : ''),
      onClick: () => splitActions(s, templates, container, root)
    }))
  ]);
}

function splitActions(s, templates, container, root) {
  const acts = [];
  if (!s.is_active) acts.push({ label: '✅ Set active', primary: true, onClick: () => setActiveSplit(s, container, root) });
  acts.push({ label: '✏️ Edit', onClick: () => splitEditorModal(container, root, s, templates) });
  acts.push({ label: '🗑️ Delete', danger: true, onClick: () => deleteSplit(s, container, root) });
  actionSheet(s.name, acts);
}

async function setActiveSplit(s, container, root) {
  try {
    await sb.from('splits').update({ is_active: false }).eq('user_id', getUid()).neq('id', s.id);
    const { error } = await sb.from('splits').update({ is_active: true }).eq('id', s.id);
    if (error) throw error;
    toast('Active split set', 'ok');
    renderTrain(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to set active split', 'err');
  }
}

function splitEditorModal(container, root, existing, templates) {
  const nameInput = el('input', { placeholder: 'e.g. My PPL', value: existing?.name || '', style: 'margin-top:0' });
  const daySelects = WEEKDAY_LABELS.map((_, i) => {
    const sel = el('select', {}, [
      el('option', { value: '' }, 'Rest'),
      ...templates.map(t => el('option', { value: t.id }, t.name))
    ]);
    const existingId = existing?.schedule?.[String(i)];
    if (existingId) sel.value = existingId;
    return sel;
  });

  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, existing ? 'Save changes' : 'Create split');

  saveBtn.addEventListener('click', async () => {
    if (!nameInput.value.trim()) { err.textContent = 'Give the split a name.'; err.hidden = false; return; }
    const schedule = {};
    daySelects.forEach((sel, i) => { if (sel.value) schedule[String(i)] = sel.value; });
    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      if (existing) {
        const { error } = await sb.from('splits').update({ name: nameInput.value.trim(), schedule }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('splits').insert({ user_id: getUid(), name: nameInput.value.trim(), schedule, is_active: false });
        if (error) throw error;
      }
      closeModal();
      toast('Split saved', 'ok');
      renderTrain(container, root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = existing ? 'Save changes' : 'Create split';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, existing ? 'Edit split' : 'New split'),
    el('label', {}, ['Split name', nameInput]),
    el('div', { class: 'section-head', style: 'margin:6px 2px 10px' }, [el('h2', {}, 'Weekly schedule')]),
    ...WEEKDAY_LABELS.map((label, i) => el('label', {}, [label, daySelects[i]])),
    err,
    saveBtn
  ]));
}

function deleteSplit(s, container, root) {
  confirmModal({
    title: 'Delete split?', confirmText: 'Delete',
    onConfirm: async () => {
      const { error } = await sb.from('splits').delete().eq('id', s.id);
      if (error) throw error;
      toast('Deleted');
      renderTrain(container, root);
    }
  });
}

// ── Presets ───────────────────────────────────────────────────────────────
function presetPicker(container, root) {
  actionSheet('Quick-start a split', PRESETS.map(p => ({
    label: `${p.label} — ${p.sub}`,
    onClick: () => applyPreset(p, container, root)
  })));
}

async function applyPreset(preset, container, root) {
  try {
    const uid = getUid();
    const idByName = {};
    for (const [name, exercises] of Object.entries(preset.templates)) {
      const { data, error } = await sb.from('workout_templates').insert({ user_id: uid, name, exercises }).select().single();
      if (error) throw error;
      idByName[name] = data.id;
    }
    const schedule = {};
    preset.schedule.forEach((name, i) => { if (name) schedule[String(i)] = idByName[name]; });
    await sb.from('splits').update({ is_active: false }).eq('user_id', uid);
    const { error } = await sb.from('splits').insert({ user_id: uid, name: preset.label, schedule, is_active: true });
    if (error) throw error;
    toast(preset.label + ' set up 💪', 'ok');
    renderTrain(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to set up preset', 'err');
  }
}
