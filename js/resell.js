// Reselling view: inventory, sales, and a profit/ROI dashboard.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, money, fmtDate, todayISO, toast, formModal, confirmModal, actionSheet, emptyState
} from './ui.js';
import { lineChart, barChart, chartCard } from './charts.js';

const BUCKET = 'resell-photos';
const profitOf = s => (Number(s.sale_price) || 0) - (Number(s.fees) || 0) -
  (Number(s.shipping_cost) || 0) - (Number(s.cost_snapshot) || 0);

async function loadData() {
  const [items, sales] = await Promise.all([
    sb.from('resell_items').select('*').order('created_at', { ascending: false }),
    sb.from('resell_sales').select('*').order('sold_date', { ascending: false })
  ]);
  if (items.error) throw items.error;
  if (sales.error) throw sales.error;
  return { items: items.data || [], sales: sales.data || [] };
}

// Load a private-bucket thumbnail into an <img> without blocking the list render.
async function fillThumb(img, path) {
  try {
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) img.src = data.signedUrl;
  } catch { /* leave the fallback emoji */ }
}

export async function renderResell(root) {
  root.innerHTML = '';
  root.append(el('p', { class: 'muted' }, 'Loading…'));
  let data;
  try {
    data = await loadData();
  } catch (ex) {
    root.innerHTML = '';
    root.append(emptyState('⚠️', 'Could not load data. ' + (ex.message || '')));
    return;
  }
  const { items, sales } = data;
  root.innerHTML = '';

  // ── Dashboard stats ──
  const totalProfit = sales.reduce((a, s) => a + profitOf(s), 0);
  const investedSold = sales.reduce((a, s) => a + (Number(s.cost_snapshot) || 0), 0);
  const roi = investedSold > 0 ? (totalProfit / investedSold) * 100 : 0;
  const inStock = items.filter(i => i.status !== 'sold').length;

  root.append(el('div', { class: 'stat-grid' }, [
    stat('Profit', money(totalProfit), totalProfit > 0 ? 'pos' : totalProfit < 0 ? 'neg' : ''),
    stat('ROI', (investedSold ? (roi >= 0 ? '+' : '') + roi.toFixed(0) + '%' : '—'), roi > 0 ? 'pos' : roi < 0 ? 'neg' : ''),
    stat('In stock', String(inStock)),
    stat('Sold', String(sales.length))
  ]));

  // ── Inventory (not yet sold) ──
  const inventory = items.filter(i => i.status !== 'sold');
  root.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Inventory')]));
  if (!inventory.length) {
    root.append(emptyState('📦', 'No items yet. Tap + to add your first one.'));
  } else {
    root.append(el('div', { class: 'list' }, inventory.map(i => itemRow(i, root))));
  }

  // ── Insights (charts) ──
  if (sales.length >= 2) {
    root.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Insights')]));

    // Cumulative profit over time
    const dated = sales.filter(s => s.sold_date).sort((a, b) => (a.sold_date < b.sold_date ? -1 : 1));
    if (dated.length >= 2) {
      let cum = 0;
      const series = dated.map(s => ({ t: s.sold_date, v: (cum += profitOf(s)) }));
      root.append(chartCard('Cumulative profit', lineChart(series, {
        color: 'var(--green)', fmt: money
      })));
    }

    // Profit by platform
    const byPlat = {};
    for (const s of sales) {
      const k = s.platform && s.platform.trim() ? s.platform.trim() : 'Other';
      byPlat[k] = (byPlat[k] || 0) + profitOf(s);
    }
    const bars = Object.entries(byPlat)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    if (bars.length) root.append(chartCard('Profit by platform', barChart(bars, { fmt: money })));
  }

  // ── Recent sales ──
  if (sales.length) {
    root.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Recent sales')]));
    root.append(el('div', { class: 'list' }, sales.slice(0, 20).map(s => saleRow(s, root))));
  }

  // ── Add button ──
  root.append(el('button', { class: 'fab', title: 'Add item', onClick: () => addItemForm(root) }, '+'));
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
    thumb = el('img', { class: 'thumb', alt: '' });
    fillThumb(thumb, item.photo_url);
  } else {
    thumb = el('div', { class: 'thumb' }, '📦');
  }
  const sub = [item.category, item.cost != null ? 'Cost ' + money(item.cost) : null].filter(Boolean).join(' · ');
  return el('div', {
    class: 'card item', onClick: () => itemActions(item, root)
  }, [
    thumb,
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, item.name),
      el('div', { class: 'sub' }, sub || '—')
    ]),
    el('span', { class: 'pill ' + item.status }, item.status.replace('_', ' '))
  ]);
}

function saleRow(s, root) {
  const p = profitOf(s);
  return el('div', { class: 'card item', onClick: () => saleActions(s, root) }, [
    el('div', { class: 'thumb' }, '💰'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, s.item_name || 'Sale'),
      el('div', { class: 'sub' }, [s.platform, s.sold_date ? fmtDate(s.sold_date) : null].filter(Boolean).join(' · ') || '—')
    ]),
    el('div', { class: 'amt ' + (p >= 0 ? 'pos v' : 'neg v') }, money(p))
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
  actionSheet(s.item_name || 'Sale', [
    { label: '🗑️ Delete sale', danger: true, onClick: () => deleteSale(s, root) }
  ]);
}

// ── Forms ──
const itemFields = (v = {}) => ([
  { name: 'name', label: 'Item name', required: true, value: v.name, placeholder: 'e.g. Nike hoodie' },
  { name: 'category', label: 'Category', value: v.category, placeholder: 'Clothing, shoes…' },
  { name: 'cost', label: 'Cost (what you paid)', type: 'number', step: '0.01', min: '0', required: true, value: v.cost },
  { name: 'list_price', label: 'Listing price (optional)', type: 'number', step: '0.01', min: '0', value: v.list_price },
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
  formModal({
    title: 'Sold: ' + item.name,
    fields: [
      { name: 'sale_price', label: 'Sale price', type: 'number', step: '0.01', min: '0', required: true, value: item.list_price },
      { name: 'platform', label: 'Platform', placeholder: 'eBay, Depop, Vinted…' },
      { name: 'fees', label: 'Selling fees', type: 'number', step: '0.01', min: '0', value: 0 },
      { name: 'shipping_cost', label: 'Shipping cost you paid', type: 'number', step: '0.01', min: '0', value: 0 },
      { name: 'sold_date', label: 'Sold date', type: 'date', value: todayISO() }
    ],
    submitText: 'Log sale',
    onSubmit: async v => {
      const sale = {
        ...v, user_id: getUid(), item_id: item.id,
        cost_snapshot: item.cost || 0, item_name: item.name
      };
      const { error } = await sb.from('resell_sales').insert(sale);
      if (error) throw error;
      const { error: e2 } = await sb.from('resell_items').update({ status: 'sold' }).eq('id', item.id);
      if (e2) throw e2;
      toast('Sale logged 🎉', 'ok');
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
      if (item.photo_url) await sb.storage.from(BUCKET).remove([item.photo_url]).catch(() => {});
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
