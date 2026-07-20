// Reselling view: Overview (net position + cash-flow P&L calendar + break-even meter),
// Inventory (in-stock items with aging, search/sort), Products (shared + personal
// sourcing catalog), and Insights (charts + sourcing intelligence).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, money, fmtDate, todayISO, toast, formModal, confirmModal, actionSheet, emptyState,
  segmented, openModal, closeModal
} from './ui.js';
import { lineChart, barChart, chartCard } from './charts.js';
import { plCalendar } from './calendar.js';
import { renderProducts } from './products.js';

const BUCKET = 'resell-photos';
const STALE_DAYS = 60;
const profitOf = s => (Number(s.sale_price) || 0) - (Number(s.fees) || 0) -
  (Number(s.shipping_cost) || 0) - (Number(s.cost_snapshot) || 0);

let segment = 'overview'; // 'overview' | 'inventory' | 'products' | 'insights'
let calYear = null, calMonth = null; // calendar's currently-viewed month
let invSearch = '', invSort = 'newest', invStatus = 'all'; // inventory search/sort state

async function loadData() {
  const [items, sales, expenses] = await Promise.all([
    sb.from('resell_items').select('*').order('created_at', { ascending: false }),
    sb.from('resell_sales').select('*').order('sold_date', { ascending: false }),
    sb.from('resell_expenses').select('*').order('expense_date', { ascending: false })
  ]);
  if (items.error) throw items.error;
  if (sales.error) throw sales.error;
  if (expenses.error) throw expenses.error;
  return { items: items.data || [], sales: sales.data || [], expenses: expenses.data || [] };
}

// Load a private-bucket thumbnail into an <img> without blocking the list render.
async function fillThumb(img, path) {
  try {
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) img.src = data.signedUrl;
  } catch { /* leave the fallback emoji */ }
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  return Math.max(0, Math.round((now - d) / 86400000));
}

// Build a cash-flow ledger for the calendar/day-modal: purchases (−cost×originalQty on
// purchase date), sales revenue (+sale_price−fees−shipping on sold date, non-returned
// only), and expenses (−amount on expense date). Grouped by ISO date.
function buildLedger(items, activeSales, expenses) {
  const ledger = {};
  const add = (iso, amount, type, label) => {
    if (!iso) return;
    const day = ledger[iso] || { amount: 0, entries: [] };
    day.amount += amount;
    day.entries.push({ type, label, amount });
    ledger[iso] = day;
  };

  const soldQtyByItem = {};
  for (const s of activeSales) {
    if (!s.item_id) continue;
    soldQtyByItem[s.item_id] = (soldQtyByItem[s.item_id] || 0) + (Number(s.quantity) || 1);
  }
  for (const item of items) {
    const originalQty = (Number(item.quantity) || 0) + (soldQtyByItem[item.id] || 0);
    if (originalQty <= 0) continue;
    const iso = (item.purchase_date || item.created_at || '').slice(0, 10);
    add(iso, -((Number(item.cost) || 0) * originalQty), 'purchase', item.name);
  }
  for (const s of activeSales) {
    const revenue = (Number(s.sale_price) || 0) - (Number(s.fees) || 0) - (Number(s.shipping_cost) || 0);
    add(s.sold_date, revenue, 'sale', s.item_name || 'Sale');
  }
  for (const e of expenses) {
    add(e.expense_date, -(Number(e.amount) || 0), 'expense', e.category || 'Expense');
  }
  return ledger;
}

export async function renderResell(root) {
  if (calYear == null) {
    const d = new Date();
    calYear = d.getFullYear(); calMonth = d.getMonth();
  }
  root.innerHTML = '';
  root.append(segmented([
    { value: 'overview', label: 'Overview' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'products', label: 'Products' },
    { value: 'insights', label: 'Insights' }
  ], segment, v => { segment = v; renderResell(root); }));

  const body = el('div');
  root.append(body);

  if (segment === 'products') {
    renderProducts(body, product => addItemFromProduct(product, root));
    return;
  }

  body.append(el('p', { class: 'muted' }, 'Loading…'));
  let data;
  try {
    data = await loadData();
  } catch (ex) {
    body.innerHTML = '';
    body.append(emptyState('⚠️', 'Could not load data. ' + (ex.message || '')));
    return;
  }
  body.innerHTML = '';

  if (segment === 'overview') renderOverview(body, data, root);
  else if (segment === 'inventory') renderInventory(body, data, root);
  else renderInsights(body, data, root);
}

// ── Overview segment ─────────────────────────────────────────────────────────
function renderOverview(body, data, root) {
  const { items, sales, expenses } = data;
  const activeSales = sales.filter(s => !s.returned);
  const returnedSales = sales.filter(s => s.returned);

  const totalRealizedProfit = activeSales.reduce((a, s) => a + profitOf(s), 0);
  const unsoldCost = items.filter(i => i.status !== 'sold')
    .reduce((a, i) => a + (Number(i.cost) || 0) * (Number(i.quantity) || 1), 0);
  const totalExpenses = expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const netPosition = totalRealizedProfit - unsoldCost - totalExpenses;

  const investedSold = activeSales.reduce((a, s) => a + (Number(s.cost_snapshot) || 0), 0);
  const roi = investedSold > 0 ? (totalRealizedProfit / investedSold) * 100 : 0;

  const ledger = buildLedger(items, activeSales, expenses);
  const thisMonthPrefix = todayISO().slice(0, 7);
  const thisMonthTotal = Object.entries(ledger)
    .filter(([d]) => d.slice(0, 7) === thisMonthPrefix)
    .reduce((a, [, day]) => a + day.amount, 0);

  body.append(el('div', { class: 'card net-card' }, [
    el('div', { class: 'k' }, 'Net position'),
    el('div', { class: 'v ' + (netPosition > 0 ? 'pos' : netPosition < 0 ? 'neg' : '') }, money(netPosition))
  ]));

  // Break-even meter
  const outstanding = unsoldCost + totalExpenses;
  const bePct = outstanding > 0 ? Math.min(1, Math.max(0, totalRealizedProfit / outstanding)) : 1;
  const beLabel = totalRealizedProfit >= outstanding
    ? `Broken even (+${money(totalRealizedProfit - outstanding)} banked)`
    : `${money(outstanding - totalRealizedProfit)} more profit to break even`;
  body.append(el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:16px' }, [
    el('div', { class: 'meter-label' }, beLabel),
    el('div', { class: 'meter' }, [
      el('div', { class: 'meter-fill', style: `width:${(bePct * 100).toFixed(1)}%` })
    ])
  ]));

  body.append(el('div', { class: 'stat-grid' }, [
    stat('This month', money(thisMonthTotal), thisMonthTotal > 0 ? 'pos' : thisMonthTotal < 0 ? 'neg' : ''),
    stat('Inventory value', money(unsoldCost)),
    stat('ROI', investedSold ? (roi >= 0 ? '+' : '') + roi.toFixed(0) + '%' : '—', roi > 0 ? 'pos' : roi < 0 ? 'neg' : ''),
    stat('Sold', String(activeSales.length))
  ]));

  // Monthly P&L calendar (cash-flow: purchases −, sales revenue +, expenses −)
  const dayTotals = {};
  for (const [iso, day] of Object.entries(ledger)) {
    dayTotals[iso] = { profit: day.amount, count: day.entries.filter(e => e.type === 'sale').length };
  }
  body.append(plCalendar({
    year: calYear, month: calMonth, dayTotals,
    onNav: delta => {
      calMonth += delta;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      else if (calMonth > 11) { calMonth = 0; calYear++; }
      renderResell(root);
    },
    onDayClick: iso => showDayModal(iso, ledger)
  }));

  body.append(el('button', {
    class: 'btn btn-block', style: 'margin-bottom:18px', onClick: () => addExpenseForm(root)
  }, '＋ Add expense'));

  if (expenses.length) {
    body.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Expenses')]));
    body.append(el('div', { class: 'list' }, expenses.slice(0, 10).map(e => expenseRow(e, root))));
  }

  if (returnedSales.length) {
    body.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Returns')]));
    body.append(el('div', { class: 'list' }, returnedSales.slice(0, 10).map(s => returnRow(s, root))));
  }

  if (activeSales.length) {
    body.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Recent sales')]));
    body.append(el('div', { class: 'list' }, activeSales.slice(0, 10).map(s => saleRevenueRow(s, root))));
  }

  body.append(el('button', { class: 'fab', title: 'Add item', onClick: () => addItemForm(root) }, '+'));
}

function showDayModal(iso, ledger) {
  const day = ledger[iso] || { amount: 0, entries: [] };
  openModal(el('div', {}, [
    el('h3', {}, fmtDate(iso)),
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      `${day.entries.length} entr${day.entries.length === 1 ? 'y' : 'ies'} · ${money(day.amount)} net`),
    el('div', { class: 'list' }, day.entries.map(ledgerEntryRow)),
    el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:14px', onClick: closeModal }, 'Close')
  ]));
}

function ledgerEntryRow(entry) {
  const icon = entry.type === 'purchase' ? '📦' : entry.type === 'sale' ? '💰' : '🧾';
  const typeLabel = entry.type === 'purchase' ? 'Purchase' : entry.type === 'sale' ? 'Sale' : 'Expense';
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, icon),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, entry.label),
      el('div', { class: 'sub' }, typeLabel)
    ]),
    el('div', { class: 'amt ' + (entry.amount >= 0 ? 'pos v' : 'neg v') }, money(entry.amount))
  ]);
}

// Cash-flow row for Overview's Recent sales: shows revenue (sale price − fees − shipping).
function saleRevenueRow(s, root) {
  const revenue = (Number(s.sale_price) || 0) - (Number(s.fees) || 0) - (Number(s.shipping_cost) || 0);
  const qty = Number(s.quantity) || 1;
  return el('div', { class: 'card item', onClick: () => saleActions(s, root) }, [
    el('div', { class: 'thumb' }, '💰'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, (s.item_name || 'Sale') + (qty > 1 ? ` ×${qty}` : '')),
      el('div', { class: 'sub' }, [s.platform, s.sold_date ? fmtDate(s.sold_date) : null].filter(Boolean).join(' · ') || '—')
    ]),
    el('div', { class: 'amt ' + (revenue >= 0 ? 'pos v' : 'neg v') }, money(revenue))
  ]);
}

function returnRow(s, root) {
  return el('div', { class: 'card item', onClick: () => saleActions(s, root) }, [
    el('div', { class: 'thumb' }, '↩️'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, [s.item_name || 'Sale', el('span', { class: 'pill returned' }, 'Returned')]),
      el('div', { class: 'sub' }, [s.sold_date ? fmtDate(s.sold_date) : null, s.platform].filter(Boolean).join(' · ') || '—')
    ]),
    el('div', { class: 'amt dim' }, money(s.sale_price))
  ]);
}

// Analytical row (Inventory → Recently sold): Cost → Sold · margin % · ROI %.
function saleDetailRow(s, root) {
  const p = profitOf(s);
  const margin = s.sale_price ? (p / s.sale_price) * 100 : 0;
  const roi = s.cost_snapshot ? (p / s.cost_snapshot) * 100 : 0;
  const qty = Number(s.quantity) || 1;
  return el('div', { class: 'card item', onClick: () => saleActions(s, root) }, [
    el('div', { class: 'thumb' }, '💰'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, (s.item_name || 'Sale') + (qty > 1 ? ` ×${qty}` : '')),
      el('div', { class: 'sub' }, `${money(s.cost_snapshot)} → ${money(s.sale_price)} · margin ${margin.toFixed(0)}% · ROI ${roi.toFixed(0)}%`)
    ]),
    el('div', { class: 'amt ' + (p >= 0 ? 'pos v' : 'neg v') }, money(p))
  ]);
}

// ── Inventory segment ────────────────────────────────────────────────────────
function renderInventory(body, data, root) {
  const { items, sales } = data;
  const activeSales = sales.filter(s => !s.returned);
  const inventoryAll = items.filter(i => i.status !== 'sold');
  const totalValue = inventoryAll.reduce((a, i) => a + (Number(i.cost) || 0) * (Number(i.quantity) || 1), 0);
  const avgAge = inventoryAll.length
    ? Math.round(inventoryAll.reduce((a, i) => a + daysSince(i.purchase_date || i.created_at), 0) / inventoryAll.length)
    : 0;

  body.append(el('div', { class: 'stat-grid' }, [
    stat('Inventory value', money(totalValue)),
    stat('Items', String(inventoryAll.length)),
    stat('Avg age', inventoryAll.length ? avgAge + 'd' : '—')
  ]));

  const searchInput = el('input', { type: 'text', placeholder: 'Search name or category…', value: invSearch });
  const sortSelect = el('select', {}, [
    el('option', { value: 'newest' }, 'Newest'),
    el('option', { value: 'oldest' }, 'Oldest'),
    el('option', { value: 'age' }, 'Oldest in stock'),
    el('option', { value: 'cost' }, 'Highest cost'),
    el('option', { value: 'potential' }, 'Potential profit')
  ]);
  sortSelect.value = invSort;
  const statusSelect = el('select', {}, [
    el('option', { value: 'all' }, 'All statuses'),
    el('option', { value: 'in_stock' }, 'In stock'),
    el('option', { value: 'listed' }, 'Listed')
  ]);
  statusSelect.value = invStatus;

  const listWrap = el('div');

  function applyFilters() {
    let list = inventoryAll;
    if (invStatus !== 'all') list = list.filter(i => i.status === invStatus);
    if (invSearch.trim()) {
      const q = invSearch.trim().toLowerCase();
      list = list.filter(i => (i.name || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
    }
    list = [...list];
    if (invSort === 'newest') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    else if (invSort === 'oldest') list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    else if (invSort === 'age') list.sort((a, b) => daysSince(b.purchase_date || b.created_at) - daysSince(a.purchase_date || a.created_at));
    else if (invSort === 'cost') list.sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0));
    else if (invSort === 'potential') list.sort((a, b) =>
      ((Number(b.list_price) || 0) - (Number(b.cost) || 0)) - ((Number(a.list_price) || 0) - (Number(a.cost) || 0)));
    return list;
  }

  function renderList() {
    const filtered = applyFilters();
    listWrap.innerHTML = '';
    if (!filtered.length) {
      listWrap.append(emptyState('📦', inventoryAll.length ? 'No items match your search.' : 'No items yet. Tap + to add your first one.'));
    } else {
      listWrap.append(el('div', { class: 'list' }, filtered.map(i => itemRow(i, root))));
    }
  }

  searchInput.addEventListener('input', () => { invSearch = searchInput.value; renderList(); });
  sortSelect.addEventListener('change', () => { invSort = sortSelect.value; renderList(); });
  statusSelect.addEventListener('change', () => { invStatus = statusSelect.value; renderList(); });

  body.append(el('div', { class: 'search-row' }, [searchInput]));
  body.append(el('div', { class: 'row', style: 'margin-bottom:18px' }, [sortSelect, statusSelect]));
  body.append(el('div', { class: 'section-head' }, [el('h2', {}, 'In stock')]));
  body.append(listWrap);
  renderList();

  if (activeSales.length) {
    body.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Recently sold')]));
    body.append(el('div', { class: 'list' }, activeSales.slice(0, 15).map(s => saleDetailRow(s, root))));
  }

  body.append(el('button', { class: 'fab', title: 'Add item', onClick: () => addItemForm(root) }, '+'));
}

// ── Insights segment ─────────────────────────────────────────────────────────
function renderInsights(body, data, root) {
  const { items, sales } = data;
  const activeSales = sales.filter(s => !s.returned);

  if (activeSales.length >= 2) {
    const dated = activeSales.filter(s => s.sold_date).sort((a, b) => (a.sold_date < b.sold_date ? -1 : 1));
    if (dated.length >= 2) {
      let cum = 0;
      const series = dated.map(s => ({ t: s.sold_date, v: (cum += profitOf(s)) }));
      body.append(chartCard('Cumulative profit', lineChart(series, { color: 'var(--green)', fmt: money })));
    }
  }

  const byPlat = {};
  for (const s of activeSales) {
    const k = s.platform && s.platform.trim() ? s.platform.trim() : 'Other';
    byPlat[k] = (byPlat[k] || 0) + profitOf(s);
  }
  const platBars = Object.entries(byPlat).map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6);
  if (platBars.length) body.append(chartCard('Profit by platform', barChart(platBars, { fmt: money })));

  const categoryBars = buildCategoryStats(items, activeSales).slice(0, 6);
  if (categoryBars.length) body.append(chartCard('Profit by category', barChart(categoryBars, { fmt: money })));

  const products = buildSourcingStats(items, sales);
  body.append(el('div', { class: 'section-head', style: 'margin-top:8px' }, [el('h2', {}, 'Top products')]));
  if (!products.length) {
    body.append(emptyState('📊', 'Sell a few items to see product insights.'));
  } else {
    body.append(el('div', { class: 'list' }, products.slice(0, 10).map(sourcingRow)));
  }
}

function buildCategoryStats(items, activeSales) {
  const itemById = {};
  for (const i of items) itemById[i.id] = i;
  const byCat = {};
  for (const s of activeSales) {
    const item = s.item_id ? itemById[s.item_id] : null;
    const cat = (item && item.category && item.category.trim()) ? item.category.trim() : 'Other';
    byCat[cat] = (byCat[cat] || 0) + profitOf(s);
  }
  return Object.entries(byCat).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// Group all sales (active + returned) by item name for return-rate, and derive
// units sold / avg profit from active sales only, plus a restock hint.
function buildSourcingStats(items, sales) {
  const byName = {};
  for (const s of sales) {
    const name = s.item_name || 'Unnamed';
    const g = byName[name] || { active: [], all: [] };
    g.all.push(s);
    if (!s.returned) g.active.push(s);
    byName[name] = g;
  }
  const stockByName = {};
  for (const i of items) {
    if (i.status === 'sold') continue;
    stockByName[i.name] = (stockByName[i.name] || 0) + (Number(i.quantity) || 0);
  }
  const products = Object.entries(byName).map(([name, g]) => {
    const unitsSold = g.active.reduce((a, s) => a + (Number(s.quantity) || 1), 0);
    const totalProfit = g.active.reduce((a, s) => a + profitOf(s), 0);
    const returnedCount = g.all.filter(s => s.returned).length;
    const returnRate = g.all.length ? (returnedCount / g.all.length) * 100 : 0;
    const inStock = stockByName[name] || 0;
    return {
      name, unitsSold, totalProfit,
      avgProfit: unitsSold ? totalProfit / unitsSold : 0,
      returnRate, inStock, restock: unitsSold > 0 && inStock === 0
    };
  }).filter(p => p.unitsSold > 0 || p.returnRate > 0);
  products.sort((a, b) => b.totalProfit - a.totalProfit);
  return products;
}

function sourcingRow(p) {
  const bits = [`${p.unitsSold} sold`, `avg ${money(p.avgProfit)}`];
  if (p.returnRate > 0) bits.push(`${p.returnRate.toFixed(0)}% returned`);
  if (p.restock) bits.push('0 left — restock');
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '📦'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, p.name),
      el('div', { class: 'sub' }, bits.join(' · '))
    ]),
    el('div', { class: 'amt ' + (p.totalProfit >= 0 ? 'pos v' : 'neg v') }, money(p.totalProfit))
  ]);
}

function stat(k, v, cls = '') {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'k' }, k),
    el('div', { class: 'v ' + cls }, v)
  ]);
}

function itemRow(item, root) {
  let thumb;
  if (item.photo_url) {
    if (/^(https?:\/\/|products\/)/i.test(item.photo_url)) {
      thumb = el('img', { class: 'thumb', src: item.photo_url, alt: '' });
    } else {
      thumb = el('img', { class: 'thumb', alt: '' });
      fillThumb(thumb, item.photo_url);
    }
  } else {
    thumb = el('div', { class: 'thumb' }, '📦');
  }
  const age = daysSince(item.purchase_date || item.created_at);
  const stale = item.status !== 'sold' && age > STALE_DAYS;
  const qty = Number(item.quantity) || 1;
  const subParts = [
    item.category,
    item.cost != null ? 'Cost ' + money(item.cost) : null,
    item.status !== 'sold' ? age + 'd in stock' : null
  ].filter(Boolean);
  return el('div', {
    class: 'card item', onClick: () => itemActions(item, root)
  }, [
    thumb,
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, [
        item.name,
        qty > 1 ? el('span', { class: 'dim' }, ` ×${qty}`) : null,
        stale ? el('span', { class: 'badge-stale' }, 'Stale') : null
      ]),
      el('div', { class: 'sub' }, subParts.join(' · ') || '—'),
      item.product_url ? el('a', {
        class: 'p-link', href: item.product_url, target: '_blank', rel: 'noopener',
        onClick: e => e.stopPropagation()
      }, 'View link ↗') : null
    ]),
    el('span', { class: 'pill ' + item.status }, item.status.replace('_', ' '))
  ]);
}

function expenseRow(e, root) {
  return el('div', { class: 'card item', onClick: () => expenseActions(e, root) }, [
    el('div', { class: 'thumb' }, '🧾'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, e.category || 'Expense'),
      el('div', { class: 'sub' }, [e.expense_date ? fmtDate(e.expense_date) : null, e.note].filter(Boolean).join(' · ') || '—')
    ]),
    el('div', { class: 'amt neg v' }, money(-(Number(e.amount) || 0)))
  ]);
}

// ── Actions ──
function itemActions(item, root) {
  const acts = [];
  if (item.status !== 'sold') acts.push({ label: '💵 Mark as sold', primary: true, onClick: () => markSoldForm(item, root) });
  acts.push({ label: '✏️ Edit', onClick: () => editItemForm(item, root) });
  acts.push({ label: '🗑️ Delete', danger: true, onClick: () => deleteItem(item, root) });
  actionSheet(item.name, acts);
}

function saleActions(s, root) {
  const acts = [];
  if (!s.returned) {
    acts.push({ label: '↩️ Mark as returned', onClick: () => returnSaleForm(s, root) });
    acts.push({ label: '✏️ Edit sale', onClick: () => editSaleForm(s, root) });
  }
  acts.push({ label: '🗑️ Delete sale', danger: true, onClick: () => deleteSale(s, root) });
  actionSheet(s.item_name || 'Sale', acts);
}

function expenseActions(e, root) {
  actionSheet(e.category || 'Expense', [
    { label: '🗑️ Delete', danger: true, onClick: () => {
      confirmModal({
        title: 'Delete expense?', confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('resell_expenses').delete().eq('id', e.id);
          if (error) throw error;
          toast('Deleted');
          renderResell(root);
        }
      });
    } }
  ]);
}

// ── Forms ──
const itemFields = (v = {}) => ([
  { name: 'name', label: 'Item name', required: true, value: v.name, placeholder: 'e.g. Nike hoodie' },
  { name: 'category', label: 'Category', value: v.category, placeholder: 'Clothing, shoes…' },
  { name: 'cost', label: 'Cost per unit (what you paid)', type: 'number', step: '0.01', min: '0', required: true, value: v.cost },
  { name: 'quantity', label: 'Quantity in stock', type: 'number', step: '1', min: '1', required: true, value: v.quantity ?? 1 },
  { name: 'list_price', label: 'Listing price (optional)', type: 'number', step: '0.01', min: '0', value: v.list_price },
  { name: 'product_url', label: 'Link (optional)', value: v.product_url, placeholder: 'https://…' },
  { name: 'source', label: 'Source (optional)', value: v.source, placeholder: 'Thrift store, wholesale…' },
  { name: 'purchase_date', label: 'Purchase date', type: 'date', value: v.purchase_date || todayISO() },
  {
    name: 'status', label: 'Status', type: 'select', value: v.status || 'in_stock',
    options: [{ value: 'in_stock', label: 'In stock' }, { value: 'listed', label: 'Listed' }]
  },
  { name: 'notes', label: 'Notes (optional)', type: 'textarea', value: v.notes }
]);

function addItemForm(root) {
  formModal({
    title: 'Add item',
    fields: [...itemFields(), { name: 'photo', label: 'Photo (optional)', type: 'file' }],
    submitText: 'Add item',
    onSubmit: async v => {
      const { photo, ...fields } = v;
      const { data, error } = await sb.from('resell_items')
        .insert({ ...fields, user_id: getUid() }).select().single();
      if (error) throw error;
      if (photo) await uploadPhoto(data.id, photo);
      toast('Item added', 'ok');
      renderResell(root);
    }
  });
}

// Prefill the add-item form from a saved product (image_url + link copied as-is; no upload).
function addItemFromProduct(product, root) {
  formModal({
    title: 'Add: ' + product.name,
    fields: itemFields({
      name: product.name, cost: product.default_cost, category: product.category,
      product_url: product.product_url
    }),
    submitText: 'Add item',
    onSubmit: async v => {
      const payload = { ...v, user_id: getUid() };
      if (product.image_url) payload.photo_url = product.image_url;
      const { error } = await sb.from('resell_items').insert(payload);
      if (error) throw error;
      toast('Item added', 'ok');
      segment = 'inventory';
      renderResell(root);
    }
  });
}

function editItemForm(item, root) {
  formModal({
    title: 'Edit item',
    fields: itemFields(item),
    submitText: 'Save changes',
    onSubmit: async v => {
      const { error } = await sb.from('resell_items').update(v).eq('id', item.id);
      if (error) throw error;
      toast('Saved', 'ok');
      renderResell(root);
    }
  });
}

function markSoldForm(item, root) {
  const maxQty = Number(item.quantity) || 1;
  const multi = maxQty > 1;
  formModal({
    title: 'Sold: ' + item.name,
    fields: [
      ...(multi ? [{
        name: 'qty_sold', label: `Quantity sold (of ${maxQty} in stock)`,
        type: 'number', step: '1', min: '1', max: String(maxQty), required: true, value: maxQty
      }] : []),
      { name: 'sale_price', label: multi ? 'Sale price per unit' : 'Sale price', type: 'number', step: '0.01', min: '0', required: true, value: item.list_price },
      { name: 'platform', label: 'Platform', placeholder: 'eBay, Depop, Vinted…' },
      { name: 'fees', label: 'Selling fees' + (multi ? ' (total)' : ''), type: 'number', step: '0.01', min: '0', value: 0 },
      { name: 'shipping_cost', label: 'Shipping cost you paid' + (multi ? ' (total)' : ''), type: 'number', step: '0.01', min: '0', value: 0 },
      { name: 'sold_date', label: 'Sold date', type: 'date', value: todayISO() }
    ],
    submitText: 'Log sale',
    onSubmit: async v => {
      const { qty_sold, ...rest } = v;
      const qtySold = Math.min(maxQty, Math.max(1, Number(qty_sold) || maxQty));
      const sale = {
        ...rest, sale_price: (Number(rest.sale_price) || 0) * (multi ? qtySold : 1),
        user_id: getUid(), item_id: item.id,
        cost_snapshot: (Number(item.cost) || 0) * qtySold, item_name: item.name, quantity: qtySold
      };
      const { error } = await sb.from('resell_sales').insert(sale);
      if (error) throw error;
      const remaining = maxQty - qtySold;
      const update = remaining > 0 ? { quantity: remaining } : { status: 'sold', quantity: 0 };
      const { error: e2 } = await sb.from('resell_items').update(update).eq('id', item.id);
      if (e2) throw e2;
      toast(remaining > 0 ? `Sold ${qtySold} — ${remaining} left in stock 🎉` : 'Sale logged 🎉', 'ok');
      renderResell(root);
    }
  });
}

function editSaleForm(s, root) {
  formModal({
    title: 'Edit sale',
    fields: [
      { name: 'sale_price', label: 'Sale price', type: 'number', step: '0.01', min: '0', required: true, value: s.sale_price },
      { name: 'platform', label: 'Platform', value: s.platform, placeholder: 'eBay, Depop, Vinted…' },
      { name: 'fees', label: 'Selling fees', type: 'number', step: '0.01', min: '0', value: s.fees },
      { name: 'shipping_cost', label: 'Shipping cost you paid', type: 'number', step: '0.01', min: '0', value: s.shipping_cost },
      { name: 'sold_date', label: 'Sold date', type: 'date', value: s.sold_date || todayISO() }
    ],
    submitText: 'Save changes',
    onSubmit: async v => {
      const { error } = await sb.from('resell_sales').update(v).eq('id', s.id);
      if (error) throw error;
      toast('Saved', 'ok');
      renderResell(root);
    }
  });
}

function returnSaleForm(s, root) {
  formModal({
    title: 'Return: ' + (s.item_name || 'Sale'),
    fields: [
      { name: 'return_cost', label: 'Return cost (postage/fees you ate, optional)', type: 'number', step: '0.01', min: '0', value: 0 }
    ],
    submitText: 'Mark as returned',
    onSubmit: async v => {
      const { error } = await sb.from('resell_sales').update({ returned: true }).eq('id', s.id);
      if (error) throw error;

      if (s.item_id) {
        const { data: item, error: e1 } = await sb.from('resell_items')
          .select('quantity,status').eq('id', s.item_id).single();
        if (!e1 && item) {
          const patch = { quantity: (Number(item.quantity) || 0) + (Number(s.quantity) || 1) };
          if (item.status === 'sold') patch.status = 'in_stock';
          const { error: e2 } = await sb.from('resell_items').update(patch).eq('id', s.item_id);
          if (e2) throw e2;
        }
      }

      const returnCost = Number(v.return_cost) || 0;
      if (returnCost > 0) {
        const { error: e3 } = await sb.from('resell_expenses').insert({
          user_id: getUid(), category: 'Return', amount: returnCost,
          expense_date: todayISO(), note: s.item_name || 'Return'
        });
        if (e3) throw e3;
      }

      toast('Marked as returned ↩️', 'ok');
      renderResell(root);
    }
  });
}

function addExpenseForm(root) {
  formModal({
    title: 'Add expense',
    fields: [
      { name: 'category', label: 'Category', placeholder: 'Postage, packaging, subscription…' },
      { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'expense_date', label: 'Date', type: 'date', value: todayISO() },
      { name: 'note', label: 'Note (optional)', type: 'textarea' }
    ],
    submitText: 'Add expense',
    onSubmit: async v => {
      const { error } = await sb.from('resell_expenses').insert({ ...v, user_id: getUid() });
      if (error) throw error;
      toast('Expense added', 'ok');
      renderResell(root);
    }
  });
}

function deleteItem(item, root) {
  confirmModal({
    title: 'Delete item?',
    message: `"${item.name}" will be removed. Any logged sale for it stays in your history.`,
    confirmText: 'Delete',
    onConfirm: async () => {
      if (item.photo_url && !/^(https?:\/\/|products\/)/i.test(item.photo_url)) {
        await sb.storage.from(BUCKET).remove([item.photo_url]).catch(() => {});
      }
      const { error } = await sb.from('resell_items').delete().eq('id', item.id);
      if (error) throw error;
      toast('Deleted');
      renderResell(root);
    }
  });
}

function deleteSale(s, root) {
  confirmModal({
    title: 'Delete sale?',
    message: 'This removes the sale from your profit totals.',
    confirmText: 'Delete',
    onConfirm: async () => {
      const { error } = await sb.from('resell_sales').delete().eq('id', s.id);
      if (error) throw error;
      toast('Deleted');
      renderResell(root);
    }
  });
}

async function uploadPhoto(itemId, file) {
  const uid = getUid();
  const path = `${uid}/${itemId}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) { toast('Photo upload failed', 'err'); return; }
  await sb.from('resell_items').update({ photo_url: path }).eq('id', itemId);
}
