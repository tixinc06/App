// Home launcher: the landing screen with one card per section. Tapping a card
// hands control back to app.js via onSelect(key), which drills into that section.
import { sb } from './supabase.js';
import { el, money, num, todayISO, staggerChildren } from './ui.js';
import { loadFriendships } from './profile.js';
import { isAdmin } from './admin.js';

const SECTIONS = [
  { key: 'resell', icon: '📦', name: 'Reselling', sub: 'Inventory, sales & profit' },
  { key: 'food', icon: '🍽️', name: 'Food', sub: 'Calories & macros' },
  { key: 'fitness', icon: '💪', name: 'Fitness', sub: 'Workouts & bodyweight' },
  { key: 'friends', icon: '👥', name: 'Friends', sub: 'Add friends & compare' }
];

const ADMIN_SECTION = { key: 'admin', icon: '🛡️', name: 'Admin', sub: 'Manage users & progress' };

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
