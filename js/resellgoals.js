// Reselling → Goals segment: a monthly profit target reverse-engineered into
// "sell ~N/day at ~£P each", a progress bar with pace/projection, and duo
// goals — two accepted friends working toward one COMBINED monthly target.
// Friends are the app-wide list from js/profile.js (shared with Fitness).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, money, toast, formModal, confirmModal, emptyState,
  skeleton, staggerChildren, todayISO
} from './ui.js';
import { loadFriendships, otherIdOf } from './profile.js';

const profitOf = s => (Number(s.sale_price) || 0) - (Number(s.fees) || 0) -
  (Number(s.shipping_cost) || 0) - (Number(s.cost_snapshot) || 0);

// Shown until the user has enough sales history to derive real averages.
const DEFAULT_AVG_SALE_PRICE = 40;
const DEFAULT_AVG_PROFIT_PER_SALE = 20;

let goalsView = 'solo'; // 'solo' | 'duo'

function deriveAverages(sales) {
  const active = sales.filter(s => !s.returned && Number(s.sale_price) > 0);
  if (!active.length) return { avgSalePrice: null, avgProfitPerSale: null };
  const avgSalePrice = active.reduce((a, s) => a + Number(s.sale_price || 0), 0) / active.length;
  const avgProfitPerSale = active.reduce((a, s) => a + profitOf(s), 0) / active.length;
  return { avgSalePrice, avgProfitPerSale };
}

function thisMonthProfit(sales) {
  const prefix = todayISO().slice(0, 7);
  return sales
    .filter(s => !s.returned && (s.sold_date || '').slice(0, 7) === prefix)
    .reduce((a, s) => a + profitOf(s), 0);
}

async function loadGoalState() {
  const uid = getUid();
  const [{ data: goal, error: gErr }, { data: sales, error: sErr }] = await Promise.all([
    sb.from('resell_goals').select('*').eq('user_id', uid).maybeSingle(),
    sb.from('resell_sales').select('sale_price,fees,shipping_cost,cost_snapshot,sold_date,returned')
  ]);
  if (gErr) throw gErr;
  if (sErr) throw sErr;
  return { goal, sales: sales || [] };
}

// Lightweight loader for the slim progress bar shown atop Reselling Overview.
// Returns null if no goal is set yet (bar stays hidden).
export async function loadTopBarGoal() {
  const uid = getUid();
  const [{ data: goal, error: gErr }, { data: sales, error: sErr }] = await Promise.all([
    sb.from('resell_goals').select('target_profit').eq('user_id', uid).maybeSingle(),
    sb.from('resell_sales').select('sale_price,fees,shipping_cost,cost_snapshot,sold_date,returned')
  ]);
  if (gErr) throw gErr;
  if (sErr) throw sErr;
  const target = Number(goal?.target_profit) || 0;
  if (!target) return null;
  return { target, profit: thisMonthProfit(sales || []) };
}

export async function renderGoals(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(3, 'item'));
  let state;
  try {
    state = await loadGoalState();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load goals. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  container.append(el('div', { class: 'row', style: 'margin-bottom:16px;gap:8px' }, [
    el('button', {
      class: 'btn btn-sm ' + (goalsView === 'solo' ? 'btn-primary' : 'btn-ghost'),
      onClick: () => { goalsView = 'solo'; renderGoals(container, root); }
    }, 'My Goal'),
    el('button', {
      class: 'btn btn-sm ' + (goalsView === 'duo' ? 'btn-primary' : 'btn-ghost'),
      onClick: () => { goalsView = 'duo'; renderGoals(container, root); }
    }, 'Duo Goals')
  ]));

  if (goalsView === 'duo') {
    await renderDuoSection(container, root);
    return;
  }

  const derived = deriveAverages(state.sales);
  const target = Number(state.goal?.target_profit) || 0;
  if (!target) {
    container.append(noGoalCard(derived, container, root));
    return;
  }

  const avgSalePrice = state.goal?.avg_sale_price ?? derived.avgSalePrice ?? DEFAULT_AVG_SALE_PRICE;
  const avgProfitPerSale = state.goal?.avg_profit_per_sale ?? derived.avgProfitPerSale ?? DEFAULT_AVG_PROFIT_PER_SALE;
  const monthProfit = thisMonthProfit(state.sales);

  container.append(soloGoalCard({ target, avgSalePrice, avgProfitPerSale, monthProfit, goal: state.goal, derived }, container, root));
}

function noGoalCard(derived, container, root) {
  return el('div', { class: 'card', style: 'padding:20px;text-align:center' }, [
    el('div', { style: 'font-size:30px;margin-bottom:8px' }, '🎯'),
    el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Set a monthly profit goal'),
    el('div', { class: 'muted', style: 'margin-bottom:14px' }, "We'll work out how many sales a day you need to hit it."),
    el('button', { class: 'btn btn-primary', onClick: () => editGoalForm(null, derived, container, root) }, 'Set goal')
  ]);
}

function calcRow(label, value, big = false) {
  return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:6px 0' }, [
    el('div', { class: big ? '' : 'muted', style: big ? 'font-weight:700' : '' }, label),
    el('div', { style: big ? 'font-weight:800;font-size:16px' : 'font-weight:700' }, value)
  ]);
}

function soloGoalCard(data, container, root) {
  const { target, avgSalePrice, avgProfitPerSale, monthProfit, goal, derived } = data;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();

  const unitsPerMonth = avgProfitPerSale > 0 ? Math.ceil(target / avgProfitPerSale) : 0;
  const unitsPerDay = unitsPerMonth / daysInMonth;
  const margin = avgSalePrice > 0 ? (avgProfitPerSale / avgSalePrice) * 100 : 0;

  const pct = target > 0 ? Math.min(1, Math.max(0, monthProfit / target)) : 0;
  const monthPct = dayOfMonth / daysInMonth;
  const paceRatio = monthPct > 0 ? pct / monthPct : 1;

  let paceLabel, paceClass;
  if (monthProfit >= target) { paceLabel = '🎉 Goal hit!'; paceClass = 'pos'; }
  else if (paceRatio >= 1.05) { paceLabel = '🔥 Ahead of pace'; paceClass = 'pos'; }
  else if (paceRatio >= 0.9) { paceLabel = '✅ On track'; paceClass = ''; }
  else { paceLabel = '⏳ Behind pace'; paceClass = 'neg'; }

  const dailyRunRate = dayOfMonth > 0 ? monthProfit / dayOfMonth : 0;
  const projected = dailyRunRate * daysInMonth;

  return el('div', {}, [
    el('div', { class: 'card', style: 'padding:18px;margin-bottom:16px' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between' }, [
        el('div', {}, [
          el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Monthly target'),
          el('div', { style: 'font-size:26px;font-weight:800;margin-top:4px' }, money(target))
        ]),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onClick: () => editGoalForm(goal, derived, container, root)
        }, 'Edit')
      ]),
      el('div', { class: 'dim', style: 'font-size:13px;margin-top:12px' }, `${money(monthProfit)} / ${money(target)} this month`),
      el('div', { class: 'meter', style: 'margin-top:6px' }, [
        el('div', { class: 'meter-fill', style: `width:${(pct * 100).toFixed(1)}%` })
      ]),
      el('div', { style: 'font-size:12px;margin-top:8px' }, [
        el('span', { class: paceClass }, paceLabel),
        el('span', { class: 'dim' }, ` · Projected ${money(projected)} by month end`)
      ])
    ]),
    el('div', { class: 'card', style: 'padding:18px' }, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:6px' }, 'How to get there'),
      calcRow('Avg profit per sale', money(avgProfitPerSale)),
      calcRow('Avg sale price', money(avgSalePrice)),
      calcRow('Margin', margin.toFixed(0) + '%'),
      el('div', { style: 'height:1px;background:var(--border);margin:8px 0' }),
      calcRow('Units to sell this month', String(unitsPerMonth), true),
      calcRow('≈ per day', unitsPerDay.toFixed(1), true)
    ])
  ]);
}

// `existing` is the raw resell_goals row (or null) — its override fields are
// only non-null if the user has explicitly set one before. `derived` is this
// month's history-based averages, shown as a placeholder hint so leaving a
// field blank visibly means "keep following my real sales", not "zero".
function editGoalForm(existing, derived, container, root) {
  formModal({
    title: existing ? 'Edit goal' : 'Set monthly goal',
    fields: [
      { name: 'target_profit', label: 'Target profit this month', type: 'number', step: '0.01', min: '0', required: true, value: existing?.target_profit },
      {
        name: 'avg_sale_price', label: 'Avg sale price override (optional)', type: 'number', step: '0.01', min: '0',
        value: existing?.avg_sale_price,
        placeholder: derived?.avgSalePrice ? `Auto: ${money(derived.avgSalePrice)}` : 'Blank = auto from your sales'
      },
      {
        name: 'avg_profit_per_sale', label: 'Avg profit/sale override (optional)', type: 'number', step: '0.01', min: '0',
        value: existing?.avg_profit_per_sale,
        placeholder: derived?.avgProfitPerSale ? `Auto: ${money(derived.avgProfitPerSale)}` : 'Blank = auto from your sales'
      }
    ],
    submitText: 'Save goal',
    onSubmit: async v => {
      const payload = {
        user_id: getUid(),
        target_profit: Number(v.target_profit) || 0,
        avg_sale_price: v.avg_sale_price,
        avg_profit_per_sale: v.avg_profit_per_sale,
        updated_at: new Date().toISOString()
      };
      const { error } = await sb.from('resell_goals').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      toast('Goal saved', 'ok');
      renderGoals(container, root);
    }
  });
}

// ── Duo goals ─────────────────────────────────────────────────────────────
async function loadDuoState() {
  const uid = getUid();
  const [{ accepted: friends }, { data: rows, error }] = await Promise.all([
    loadFriendships(),
    sb.from('duo_goals').select('*').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
  ]);
  if (error) throw error;

  const duoOtherIds = (rows || []).map(r => otherIdOf(r, uid));
  const friendOtherIds = friends.map(f => otherIdOf(f, uid));
  const allIds = [...new Set([...duoOtherIds, ...friendOtherIds])];

  let profileById = {};
  if (allIds.length) {
    const { data: profs, error: pErr } = await sb.from('profiles').select('*').in('user_id', allIds);
    if (pErr) throw pErr;
    for (const p of (profs || [])) profileById[p.user_id] = p;
  }

  return {
    friends, profileById,
    pendingIncoming: (rows || []).filter(r => r.status === 'pending' && r.addressee_id === uid),
    pendingOutgoing: (rows || []).filter(r => r.status === 'pending' && r.requester_id === uid),
    accepted: (rows || []).filter(r => r.status === 'accepted')
  };
}

async function renderDuoSection(container, root) {
  const wrap = el('div');
  container.append(wrap);
  wrap.append(skeleton(2, 'item'));
  let state;
  try {
    state = await loadDuoState();
  } catch (ex) {
    wrap.innerHTML = '';
    wrap.append(emptyState('⚠️', 'Could not load duo goals. ' + (ex.message || '')));
    return;
  }
  wrap.innerHTML = '';

  if (state.pendingIncoming.length) {
    wrap.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Invites')]));
    const list = el('div', { class: 'list', style: 'margin-bottom:16px' }, state.pendingIncoming.map(g => {
      const prof = state.profileById[g.requester_id];
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb' }, '🤝'),
        el('div', { class: 'grow' }, [
          el('div', { class: 'title' }, '@' + (prof?.username || 'unknown')),
          el('div', { class: 'sub' }, `Duo goal · ${money(g.target_profit)}/month`)
        ]),
        el('div', { class: 'row', style: 'flex:0 0 auto;gap:6px' }, [
          el('button', { class: 'btn btn-sm btn-primary', onClick: () => respondDuo(g, true, container, root) }, 'Accept'),
          el('button', { class: 'btn btn-sm btn-ghost', onClick: () => respondDuo(g, false, container, root) }, 'Decline')
        ])
      ]);
    }));
    staggerChildren(list);
    wrap.append(list);
  }

  if (state.accepted.length) {
    wrap.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Active duo goals')]));
    const list = el('div', { class: 'list', style: 'margin-bottom:16px' });
    wrap.append(list);
    for (const g of state.accepted) {
      list.append(await duoGoalCard(g, state, container, root));
    }
  }

  if (state.pendingOutgoing.length) {
    wrap.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Sent')]));
    const list = el('div', { class: 'list', style: 'margin-bottom:16px' }, state.pendingOutgoing.map(g => {
      const prof = state.profileById[g.addressee_id];
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb' }, '🤝'),
        el('div', { class: 'grow' }, [
          el('div', { class: 'title' }, '@' + (prof?.username || 'unknown')),
          el('div', { class: 'sub' }, `Pending · ${money(g.target_profit)}/month`)
        ]),
        el('button', { class: 'btn btn-sm btn-ghost', onClick: () => cancelDuo(g, container, root) }, 'Cancel')
      ]);
    }));
    staggerChildren(list);
    wrap.append(list);
  }

  if (!state.accepted.length && !state.pendingIncoming.length && !state.pendingOutgoing.length) {
    wrap.append(emptyState('🤝', 'No duo goals yet.'));
  }

  wrap.append(el('div', { class: 'section-head', style: 'margin-top:8px' }, [el('h2', {}, 'Start a duo goal')]));
  if (!state.friends.length) {
    wrap.append(el('div', { class: 'muted' }, 'Add a friend first (Friends tab), then invite them here.'));
  } else {
    wrap.append(newDuoForm(state, container, root));
  }
}

async function duoGoalCard(g, state, container, root) {
  const uid = getUid();
  const partnerId = otherIdOf(g, uid);
  const prof = state.profileById[partnerId];
  let mine = 0, theirs = 0;
  try {
    const [{ data: a }, { data: b }] = await Promise.all([
      sb.rpc('resell_month_profit', { target_user: uid }),
      sb.rpc('resell_month_profit', { target_user: partnerId })
    ]);
    mine = Number(a) || 0; theirs = Number(b) || 0;
  } catch { /* best-effort — combined bar shows £0 if the RPC is unavailable */ }
  const combined = mine + theirs;
  const target = Number(g.target_profit) || 0;
  const pct = target > 0 ? Math.min(1, Math.max(0, combined / target)) : 0;

  return el('div', { class: 'card', style: 'padding:16px 18px' }, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between' }, [
      el('div', { style: 'font-weight:700' }, 'You + @' + (prof?.username || 'unknown')),
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => deleteDuo(g, container, root) }, 'End')
    ]),
    el('div', { style: 'font-size:20px;font-weight:800;margin-top:6px' }, `${money(combined)} / ${money(target)}`),
    el('div', { class: 'meter', style: 'margin-top:8px' }, [
      el('div', { class: 'meter-fill', style: `width:${(pct * 100).toFixed(1)}%` })
    ]),
    el('div', { class: 'dim', style: 'font-size:12px;margin-top:8px' }, `You: ${money(mine)} · Them: ${money(theirs)}`)
  ]);
}

function newDuoForm(state, container, root) {
  const uid = getUid();
  const friendSelect = el('select', {}, state.friends.map(f => {
    const oid = otherIdOf(f, uid);
    const prof = state.profileById[oid];
    return el('option', { value: oid }, '@' + (prof?.username || 'unknown'));
  }));
  const targetInput = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Target profit (£/month)', style: 'margin-top:10px' });
  const err = el('p', { class: 'form-error', hidden: true });
  const btn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:10px' }, 'Send invite');

  btn.addEventListener('click', async () => {
    const target = Number(targetInput.value);
    if (!target || target <= 0) { err.textContent = 'Enter a target amount.'; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const { error } = await sb.from('duo_goals')
        .insert({ requester_id: uid, addressee_id: friendSelect.value, target_profit: target });
      if (error) throw error;
      toast('Duo goal invite sent 🤝', 'ok');
      renderGoals(container, root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to send.';
      err.hidden = false; btn.disabled = false; btn.textContent = 'Send invite';
    }
  });

  return el('div', { class: 'card', style: 'padding:16px 18px' }, [friendSelect, targetInput, err, btn]);
}

async function respondDuo(g, accept, container, root) {
  try {
    if (accept) {
      const { error } = await sb.from('duo_goals').update({ status: 'accepted' }).eq('id', g.id);
      if (error) throw error;
      toast('Duo goal accepted 🤝', 'ok');
    } else {
      const { error } = await sb.from('duo_goals').delete().eq('id', g.id);
      if (error) throw error;
      toast('Declined');
    }
    renderGoals(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed', 'err');
  }
}

function cancelDuo(g, container, root) {
  confirmModal({
    title: 'Cancel invite?', confirmText: 'Cancel',
    onConfirm: async () => {
      const { error } = await sb.from('duo_goals').delete().eq('id', g.id);
      if (error) throw error;
      renderGoals(container, root);
    }
  });
}

function deleteDuo(g, container, root) {
  confirmModal({
    title: 'End duo goal?', confirmText: 'End goal',
    onConfirm: async () => {
      const { error } = await sb.from('duo_goals').delete().eq('id', g.id);
      if (error) throw error;
      toast('Ended');
      renderGoals(container, root);
    }
  });
}
