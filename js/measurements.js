// Body measurements: log any subset of a fixed metric list (waist, chest,
// arms, etc.) per date, see history, and a trend chart per metric that has
// enough data points. No schema surprises — `values` is a JSONB bag keyed by
// MEASUREMENT_METRICS' `key`s (js/gamedata.js), so logging only what you
// measured that day is the normal case, not an edge case.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, fmtDate, todayISO, toast, formModal, confirmModal, actionSheet, emptyState, skeleton, staggerChildren } from './ui.js';
import { MEASUREMENT_METRICS } from './gamedata.js';
import { lineChart, chartCard } from './charts.js';

async function loadMeasurements() {
  const { data, error } = await sb.from('body_measurements')
    .select('*').eq('user_id', getUid()).order('entry_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function renderMeasurements(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(3, 'item'));
  let entries;
  try {
    entries = await loadMeasurements();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load measurements. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  container.append(el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:18px', onClick: () => logForm(root, container) }, '＋ Log measurements'));

  if (!entries.length) {
    container.append(emptyState('📏', 'No measurements logged yet.'));
    return;
  }

  // ── Trend charts: one per metric with >=2 data points, oldest -> newest ──
  const chronological = [...entries].reverse();
  const chartsToShow = [];
  for (const m of MEASUREMENT_METRICS) {
    const series = chronological
      .filter(e => e.values && e.values[m.key] != null)
      .map(e => ({ t: e.entry_date, v: Number(e.values[m.key]) }));
    if (series.length >= 2) chartsToShow.push({ metric: m, series });
  }
  if (chartsToShow.length) {
    container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Trends')]));
    for (const c of chartsToShow) {
      container.append(chartCard(`${c.metric.label} · ${c.metric.unit}`, lineChart(c.series, { color: 'var(--blue)', fmt: v => num(v) })));
    }
  }

  container.append(el('div', { class: 'section-head', style: 'margin-top:20px' }, [el('h2', {}, 'History')]));
  const list = el('div', { class: 'list' }, entries.map(e => entryRow(e, root, container)));
  staggerChildren(list);
  container.append(list);
}

function entryRow(e, root, container) {
  const filled = MEASUREMENT_METRICS.filter(m => e.values?.[m.key] != null);
  const summary = filled.map(m => `${m.label} ${num(e.values[m.key])}${m.unit}`).join(' · ') || 'No values';
  return el('div', { class: 'card item', onClick: () => actionSheet(fmtDate(e.entry_date), [
    { label: '🗑️ Delete', danger: true, onClick: () => {
      confirmModal({
        title: 'Delete entry?', confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('body_measurements').delete().eq('id', e.id);
          if (error) throw error;
          toast('Deleted');
          renderMeasurements(container, root);
        }
      });
    } }
  ]) }, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, fmtDate(e.entry_date)),
      el('div', { class: 'sub' }, summary)
    ])
  ]);
}

function logForm(root, container) {
  const fields = [
    { name: 'entry_date', label: 'Date', type: 'date', value: todayISO(), required: true },
    ...MEASUREMENT_METRICS.map(m => ({
      name: m.key, label: `${m.label} (${m.unit})`, type: 'number', step: '0.1', min: '0'
    }))
  ];
  formModal({
    title: 'Log measurements',
    fields,
    submitText: 'Save',
    onSubmit: async v => {
      const values = {};
      for (const m of MEASUREMENT_METRICS) {
        if (v[m.key] !== null && v[m.key] !== undefined && v[m.key] !== '') values[m.key] = Number(v[m.key]);
      }
      if (!Object.keys(values).length) throw new Error('Enter at least one measurement.');
      const { error } = await sb.from('body_measurements').insert({ user_id: getUid(), entry_date: v.entry_date, values });
      if (error) throw error;
      toast('Logged 📏', 'ok');
      renderMeasurements(container, root);
    }
  });
}
