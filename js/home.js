// Home launcher: a daily dashboard (today snapshot, active goals, a mini-chart,
// quick-add buttons) sitting above the four section launcher cards. Tapping a
// card hands control back to app.js via onSelect(key), which drills into that
// section.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, money, num, todayISO, shiftDate, staggerChildren, countUp, toast } from './ui.js';
import { lineChart, chartCard } from './charts.js';
import { loadFriendships } from './profile.js';
import { isAdmin } from './admin.js';
import { computeStreak } from './streaks.js';
import { loadTopBarGoal } from './resellgoals.js';

const SECTIONS = [
  { key: 'resell', icon: '📦', name: 'Reselling', sub: 'Inventory, sales & profit' },
  { key: 'food', icon: '🍽️', name: 'Food', sub: 'Calories & macros' },
  { key: 'fitness', icon: '💪', name: 'Fitness', sub: 'Workouts & bodyweight' },
  { key: 'friends', icon: '👥', name: 'Friends', sub: 'Add friends & compare' },
  { key: 'settings', icon: '⚙️', name: 'Settings', sub: 'Units, currency & reminders' }
];

const ADMIN_SECTION = { key: 'admin', icon: '🛡️', name: 'Admin', sub: 'Manage users & progress' };
const DEFAULT_WATER_GOAL_ML = 2500;

// Guards against a real race: app.js's auth-state-change listener can fire
// renderActive()->renderHome() more than once around a single load (e.g. an
// initial session event followed by a token-refresh event shortly after).
// That was harmless when this function was effectively synchronous, but the
// `await isAdmin()` below opens a real gap where a second, newer call can
// start and finish before the first one resumes — without this guard, both
// calls would append their own full card set into the same container.
let homeGen = 0;

export async function renderHome(root, onSelect) {
  const myGen = ++homeGen;
  root.innerHTML = '';
  root.append(el('div', { class: 'home-greeting' }, [el('h1', {}, 'Welcome back')]));

  const dashWrap = el('div');
  root.append(dashWrap);
  loadDashboard().then(d => { if (myGen === homeGen) renderDashboard(dashWrap, d, onSelect, root); }).catch(() => {});

  // Purely presentational — the real gate is the DB trigger that stops a
  // non-admin's writes going through even if they reach this panel some
  // other way (e.g. by guessing the URL of a future deep-link).
  const admin = await isAdmin().catch(() => false);
  if (myGen !== homeGen) return; // a newer renderHome call has already taken over
  const sectionsToShow = admin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;

  const cardsWrap = el('div', { class: 'home-cards' });
  for (const s of sectionsToShow) cardsWrap.append(homeCard(s, onSelect));
  staggerChildren(cardsWrap);
  root.append(cardsWrap);

  // Fill in a live one-line stat per card, best-effort (leave the default subtitle on failure).
  loadResellStat().then(sub => updateSub(cardsWrap, 'resell', sub)).catch(() => {});
  loadFoodStat().then(sub => updateSub(cardsWrap, 'food', sub)).catch(() => {});
  loadFitnessStat().then(sub => updateSub(cardsWrap, 'fitness', sub)).catch(() => {});
  loadFriendsStat().then(sub => updateSub(cardsWrap, 'friends', sub)).catch(() => {});
}

function homeCard(s, onSelect) {
  return el('div', {
    class: 'card home-card', 'data-key': s.key, onClick: () => onSelect(s.key)
  }, [
    el('div', { class: 'home-ico' }, s.icon),
    el('div', { class: 'home-body' }, [
      el('div', { class: 'home-name' }, s.name),
      el('div', { class: 'home-sub' }, s.sub)
    ]),
    el('div', { class: 'home-arrow' }, '›')
  ]);
}

function updateSub(cardsWrap, key, sub) {
  if (!sub) return;
  const node = cardsWrap.querySelector(`[data-key="${key}"] .home-sub`);
  if (node) node.textContent = sub;
}

async function loadResellStat() {
  const [items, sales, expenses] = await Promise.all([
    sb.from('resell_items').select('cost,quantity,status'),
    sb.from('resell_sales').select('sale_price,fees,shipping_cost,cost_snapshot,returned'),
    sb.from('resell_expenses').select('amount')
  ]);
  if (items.error || sales.error || expenses.error) return null;
  const activeSales = (sales.data || []).filter(s => !s.returned);
  const profit = activeSales.reduce((a, s) =>
    a + ((Number(s.sale_price) || 0) - (Number(s.fees) || 0) - (Number(s.shipping_cost) || 0) - (Number(s.cost_snapshot) || 0)), 0);
  const unsoldCost = (items.data || []).filter(i => i.status !== 'sold')
    .reduce((a, i) => a + (Number(i.cost) || 0) * (Number(i.quantity) || 1), 0);
  const totalExpenses = (expenses.data || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
  return `Net ${money(profit - unsoldCost - totalExpenses)}`;
}

async function loadFoodStat() {
  const { data, error } = await sb.from('food_logs').select('calories').eq('log_date', todayISO());
  if (error) return null;
  const total = (data || []).reduce((a, r) => a + (Number(r.calories) || 0), 0);
  return total > 0 ? `${num(total)} kcal today` : 'No food logged today';
}

async function loadFitnessStat() {
  const { data, error } = await sb.from('workouts')
    .select('name,workout_date').order('workout_date', { ascending: false }).limit(1);
  if (error) return null;
  if (!data || !data.length) return 'No workouts yet';
  return `Last: ${data[0].name || 'Workout'}`;
}

async function loadFriendsStat() {
  const { accepted } = await loadFriendships();
  return accepted.length ? `${accepted.length} friend${accepted.length === 1 ? '' : 's'}` : 'No friends yet';
}

const profitOf = s => (Number(s.sale_price) || 0) - (Number(s.fees) || 0) -
  (Number(s.shipping_cost) || 0) - (Number(s.cost_snapshot) || 0);

function thisMonthProfit(sales) {
  const prefix = todayISO().slice(0, 7);
  return sales
    .filter(s => !s.returned && (s.sold_date || '').slice(0, 7) === prefix)
    .reduce((a, s) => a + profitOf(s), 0);
}

// Sum calories per day for the last `days` days → continuous series (zeros for gaps).
async function loadCalorieTrend(days) {
  const start = shiftDate(todayISO(), -(days - 1));
  const { data, error } = await sb.from('food_logs').select('log_date,calories').gte('log_date', start);
  if (error || !data) return [];
  const map = {};
  for (const r of data) map[r.log_date] = (map[r.log_date] || 0) + (+r.calories || 0);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = shiftDate(start, i);
    out.push({ t: d, v: map[d] || 0 });
  }
  return out;
}

// Best-effort snapshot for the dashboard widgets. Any individual piece that
// fails (e.g. a pending migration column) is left null/empty rather than
// throwing, so the rest of the dashboard still renders.
async function loadDashboard() {
  const uid = getUid();
  const today = todayISO();

  const [foodRes, waterRes, settingsRes, workoutsRes, salesRes, goalsRes, prsRes, resellGoal, trend] = await Promise.all([
    sb.from('food_logs').select('calories').eq('log_date', today),
    sb.from('water_logs').select('amount_ml').eq('user_id', uid).eq('log_date', today).maybeSingle(),
    sb.from('user_settings').select('calorie_target,water_goal_ml').eq('user_id', uid).maybeSingle(),
    sb.from('workouts').select('name,workout_date'),
    sb.from('resell_sales').select('sale_price,fees,shipping_cost,cost_snapshot,sold_date,returned'),
    sb.from('fitness_goals').select('*').eq('user_id', uid).eq('achieved', false).order('created_at', { ascending: false }).limit(1),
    sb.from('personal_records').select('exercise,best_weight'),
    loadTopBarGoal().catch(() => null),
    loadCalorieTrend(7)
  ]);

  const calorieTarget = settingsRes?.data?.calorie_target ? Number(settingsRes.data.calorie_target) : null;
  const waterGoalMl = settingsRes?.data?.water_goal_ml ? Number(settingsRes.data.water_goal_ml) : DEFAULT_WATER_GOAL_ML;
  const todayCalories = (foodRes?.data || []).reduce((a, r) => a + (Number(r.calories) || 0), 0);
  const todayWaterMl = waterRes?.data?.amount_ml ? Number(waterRes.data.amount_ml) : 0;

  const workouts = workoutsRes?.data || [];
  const sorted = [...workouts].sort((a, b) => (b.workout_date || '').localeCompare(a.workout_date || ''));
  const lastWorkoutName = sorted.length ? (sorted[0].name || 'Workout') : null;
  let streak = { current: 0 };
  try { streak = await computeStreak(workouts); } catch { /* best-effort */ }

  const monthProfit = thisMonthProfit(salesRes?.data || []);

  let fitnessGoal = null;
  const g = goalsRes?.data?.[0];
  if (g) {
    const pr = (prsRes?.data || []).find(p => p.exercise === g.exercise);
    const current = pr ? Number(pr.best_weight) : 0;
    const target = Number(g.target_weight) || 0;
    fitnessGoal = { exercise: g.exercise, current, target, pct: target ? Math.min(100, (current / target) * 100) : 0 };
  }

  return {
    todayCalories, calorieTarget, todayWaterMl, waterGoalMl,
    lastWorkoutName, streakCurrent: streak.current || 0,
    monthProfit, fitnessGoal, resellGoal, trend
  };
}

function statCell(label, value, sub) {
  const vEl = el('div', { class: 'v' }, value);
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'k' }, label),
    vEl,
    sub ? el('div', { class: 'dim', style: 'font-size:11px;margin-top:2px' }, sub) : null
  ]);
}

function renderDashboard(wrap, d, onSelect, root) {
  wrap.innerHTML = '';

  // ── Today snapshot ──
  const calStat = statCell('Calories', d.calorieTarget ? `${num(d.todayCalories)} / ${num(d.calorieTarget)}` : num(d.todayCalories),
    d.calorieTarget ? 'kcal today' : 'kcal today (no target set)');
  const waterStat = statCell('Water', `${num(d.todayWaterMl)} / ${num(d.waterGoalMl)}`, 'ml today');
  const streakStat = statCell('Streak', `🔥 ${d.streakCurrent}`, d.lastWorkoutName ? `Last: ${d.lastWorkoutName}` : 'No workouts yet');
  const profitStat = statCell('This month', money(d.monthProfit), 'realized profit');
  countUp(profitStat.querySelector('.v'), d.monthProfit, money);

  wrap.append(el('div', { class: 'section-head', style: 'margin-top:6px' }, [el('h2', {}, 'Today')]));
  wrap.append(el('div', { class: 'stat-grid' }, [calStat, waterStat, streakStat, profitStat]));

  // Water quick-add — the one true "instant" quick-add (no navigation needed).
  wrap.append(el('div', { class: 'card', style: 'padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px' }, [
    el('div', { class: 'grow dim', style: 'font-size:12px' }, '💧 Log water'),
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => addWater(250, wrap, onSelect, root) }, '+250ml'),
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => addWater(500, wrap, onSelect, root) }, '+500ml')
  ]));

  // ── Active goals ──
  const goalBars = [];
  if (d.fitnessGoal) {
    goalBars.push(goalMeter(`🏋️ ${d.fitnessGoal.exercise}`,
      `${num(d.fitnessGoal.current)} / ${num(d.fitnessGoal.target)} (${d.fitnessGoal.pct.toFixed(0)}%)`, d.fitnessGoal.pct));
  }
  if (d.resellGoal && d.resellGoal.target) {
    const pct = Math.min(100, (d.resellGoal.profit / d.resellGoal.target) * 100);
    goalBars.push(goalMeter('📦 Monthly profit target',
      `${money(d.resellGoal.profit)} / ${money(d.resellGoal.target)} (${pct.toFixed(0)}%)`, pct));
  }
  if (goalBars.length) {
    wrap.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Active goals')]));
    wrap.append(...goalBars);
  }

  // ── Mini chart ──
  if (d.trend && d.trend.some(p => p.v > 0)) {
    wrap.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Calories · last 7 days')]));
    wrap.append(chartCard('Calories', lineChart(d.trend, { color: 'var(--amber)', fmt: v => num(v) })));
  }

  // ── Quick-add row ──
  wrap.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Quick add')]));
  wrap.append(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:22px' }, [
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => onSelect('food') }, '🍽️ Log food'),
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => onSelect('fitness') }, '💪 Log workout'),
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => onSelect('fitness') }, '⚖️ Log weight')
  ]));
}

function goalMeter(label, sub, pct) {
  return el('div', { class: 'card', style: 'padding:14px 16px;margin-bottom:12px' }, [
    el('div', { style: 'display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:8px' }, [
      el('span', {}, label), el('span', { class: 'dim' }, sub)
    ]),
    el('div', { class: 'meter' }, [el('div', { class: 'meter-fill', style: `width:${pct.toFixed(1)}%` })])
  ]);
}

async function addWater(amount, wrap, onSelect, root) {
  try {
    const uid = getUid();
    const today = todayISO();
    const { data: existing } = await sb.from('water_logs').select('id,amount_ml').eq('user_id', uid).eq('log_date', today).maybeSingle();
    if (existing) {
      const { error } = await sb.from('water_logs').update({ amount_ml: (Number(existing.amount_ml) || 0) + amount }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('water_logs').insert({ user_id: uid, log_date: today, amount_ml: amount });
      if (error) throw error;
    }
    toast(`+${amount}ml water`, 'ok');
    loadDashboard().then(d => renderDashboard(wrap, d, onSelect, root)).catch(() => {});
  } catch (ex) {
    toast(ex.message || 'Failed to log water', 'err');
  }
}
