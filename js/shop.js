// Shop tab: spend Plates on themes (app-wide recolour), banners (cosmetic
// flair on the Progress tab), and instant-use XP boosters.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, toast, emptyState, skeleton, staggerChildren, segmented } from './ui.js';
import { loadProgress } from './progression.js';
import { SHOP_ITEMS, STREAK_FREEZE_COST, weekendEventMsLeft } from './gamedata.js';
import { applyTheme } from './theme.js';

let shopTab = 'themes'; // 'themes' | 'banners' | 'boosters' | 'freezes'

export async function loadShopState() {
  const uid = getUid();
  const [progress, inv, settings] = await Promise.all([
    loadProgress(),
    sb.from('user_inventory').select('*').eq('user_id', uid),
    sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle()
  ]);
  if (inv.error) throw inv.error;
  if (settings.error) throw settings.error;
  return { progress, inventory: inv.data || [], settings: settings.data || null };
}

export async function renderShop(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let state;
  try {
    state = await loadShopState();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load the shop. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  const msLeft = weekendEventMsLeft();
  if (msLeft != null) {
    const totalMins = Math.max(1, Math.round(msLeft / 60000));
    const hours = Math.floor(totalMins / 60), mins = totalMins % 60;
    const label = hours >= 24 ? `${Math.ceil(hours / 24)}d left` : `${hours}h ${mins}m left`;
    container.append(el('div', { class: 'card weekend-event-banner' }, [
      el('div', { style: 'font-weight:800' }, '⚡ Double XP & Plates all weekend'),
      el('div', { class: 'dim', style: 'font-size:12px;margin-top:2px' }, label)
    ]));
  }

  container.append(el('div', {
    class: 'card', style: 'padding:16px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between'
  }, [
    el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Your Plates'),
    el('div', { style: 'font-size:22px;font-weight:800;color:var(--amber)' }, num(state.progress.plates))
  ]));

  container.append(segmented([
    { value: 'themes', label: 'Themes' },
    { value: 'banners', label: 'Banners' },
    { value: 'boosters', label: 'Boosters' },
    { value: 'freezes', label: 'Freezes' }
  ], shopTab, v => { shopTab = v; renderShop(container, root); }));

  if (shopTab === 'themes') {
    const owned = new Set(state.inventory.filter(i => i.item_type === 'theme').map(i => i.item_code));
    const list = el('div', { class: 'list' }, SHOP_ITEMS.themes.map(t => themeRow(t, state, owned, container, root)));
    staggerChildren(list);
    container.append(list);
  } else if (shopTab === 'banners') {
    const owned = new Set(state.inventory.filter(i => i.item_type === 'banner').map(i => i.item_code));
    const list = el('div', { class: 'list' }, SHOP_ITEMS.banners.map(b => bannerRow(b, state, owned, container, root)));
    staggerChildren(list);
    container.append(list);
  } else if (shopTab === 'freezes') {
    container.append(freezeCard(state, container, root));
  } else {
    const active = state.settings?.active_booster;
    const activeLive = active && new Date(active.expires_at) > new Date();
    if (activeLive) {
      const mins = Math.ceil((new Date(active.expires_at) - new Date()) / 60000);
      container.append(el('div', { class: 'card', style: 'padding:14px 16px;margin-bottom:14px' }, [
        el('div', { style: 'font-weight:700' }, `⚡ ${active.multiplier}× XP active`),
        el('div', { class: 'dim', style: 'font-size:12px;margin-top:2px' }, `${mins} min remaining`)
      ]));
    }
    const list = el('div', { class: 'list' }, SHOP_ITEMS.boosters.map(b => boosterRow(b, state, activeLive, container, root)));
    staggerChildren(list);
    container.append(list);
  }
}

function freezeCard(state, container, root) {
  const owned = Number(state.progress.streak_freezes || 0);
  const canAfford = state.progress.plates >= STREAK_FREEZE_COST;
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '🧊'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, 'Streak Freeze'),
      el('div', { class: 'sub' }, `Protects one missed training week · You own ${owned}`)
    ]),
    el('button', {
      class: 'btn btn-sm ' + (canAfford ? 'btn-primary' : 'btn-ghost'),
      disabled: !canAfford,
      onClick: () => buyStreakFreeze(container, root)
    }, canAfford ? `Buy · ${num(STREAK_FREEZE_COST)}` : `Need ${num(STREAK_FREEZE_COST)}`)
  ]);
}

async function buyStreakFreeze(container, root) {
  try {
    const progress = await loadProgress();
    if (Number(progress.plates) < STREAK_FREEZE_COST) { toast('Not enough Plates', 'err'); return; }
    const { error } = await sb.from('fitness_progress').update({
      plates: Number(progress.plates) - STREAK_FREEZE_COST,
      streak_freezes: Number(progress.streak_freezes || 0) + 1
    }).eq('user_id', progress.user_id);
    if (error) throw error;
    toast('Streak Freeze purchased 🧊', 'ok');
    renderShop(container, root);
  } catch (ex) {
    toast(ex.message || 'Purchase failed', 'err');
  }
}

// Shared Buy/Equip/Equipped button for owned cosmetics (themes & banners).
function actionButton({ owned, equipped, price, plates, onBuy, onEquip }) {
  if (equipped) return el('span', { class: 'pill sold' }, 'Equipped');
  if (owned) return el('button', { class: 'btn btn-sm btn-primary', onClick: e => { e.stopPropagation(); onEquip(); } }, 'Equip');
  const canAfford = plates >= price;
  return el('button', {
    class: 'btn btn-sm ' + (canAfford ? 'btn-primary' : 'btn-ghost'),
    disabled: !canAfford,
    onClick: e => { e.stopPropagation(); onBuy(); }
  }, canAfford ? `Buy · ${num(price)}` : `Need ${num(price)}`);
}

function themeRow(t, state, owned, container, root) {
  const isOwned = t.price === 0 || owned.has(t.code);
  const equipped = (state.settings?.equipped_theme || 'default') === t.code;
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb', style: `background:${t.colors.primary}` }, '🎨'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, t.name),
      el('div', { class: 'sub' }, isOwned ? (equipped ? 'Equipped' : 'Owned') : `${num(t.price)} Plates`)
    ]),
    actionButton({
      owned: isOwned, equipped, price: t.price, plates: state.progress.plates,
      onBuy: () => buyItem('theme', t, container, root),
      onEquip: () => equipTheme(t, () => renderShop(container, root))
    })
  ]);
}

function bannerRow(b, state, owned, container, root) {
  const isOwned = owned.has(b.code);
  const equipped = state.settings?.equipped_banner === b.code;
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb', style: `background:${b.gradient}` }, ''),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, b.name),
      el('div', { class: 'sub' }, isOwned ? (equipped ? 'Equipped' : 'Owned') : `${num(b.price)} Plates`)
    ]),
    actionButton({
      owned: isOwned, equipped, price: b.price, plates: state.progress.plates,
      onBuy: () => buyItem('banner', b, container, root),
      onEquip: () => equipBanner(b, () => renderShop(container, root))
    })
  ]);
}

function boosterRow(b, state, activeLive, container, root) {
  const canAfford = state.progress.plates >= b.price;
  const owned = state.inventory.find(i => i.item_type === 'booster' && i.item_code === b.code);
  const qty = owned?.quantity || 0;
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '⚡'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, b.name),
      el('div', { class: 'sub' }, `${b.multiplier}× XP for ${b.durationMinutes} min · You own ${qty}`)
    ]),
    el('div', { class: 'row', style: 'flex:0 0 auto;gap:6px' }, [
      el('button', {
        class: 'btn btn-sm ' + (canAfford ? 'btn-primary' : 'btn-ghost'),
        disabled: !canAfford,
        onClick: () => buyBoosterItem(b, () => renderShop(container, root))
      }, canAfford ? `Buy · ${num(b.price)}` : `Need ${num(b.price)}`),
      qty > 0 ? el('button', {
        class: 'btn btn-sm btn-ghost', disabled: activeLive,
        onClick: () => activateOwnedBooster(b, () => renderShop(container, root))
      }, activeLive ? 'Active…' : 'Activate') : null
    ])
  ]);
}

async function buyItem(itemType, item, container, root) {
  try {
    const progress = await loadProgress();
    if (Number(progress.plates) < item.price) { toast('Not enough Plates', 'err'); return; }
    const { error: pErr } = await sb.from('fitness_progress')
      .update({ plates: Number(progress.plates) - item.price }).eq('user_id', progress.user_id);
    if (pErr) throw pErr;
    const { error: iErr } = await sb.from('user_inventory')
      .insert({ user_id: getUid(), item_code: item.code, item_type: itemType });
    if (iErr) throw iErr;
    toast(`${item.name} purchased! 🎉`, 'ok');
    renderShop(container, root);
  } catch (ex) {
    toast(ex.message || 'Purchase failed', 'err');
  }
}

// Shared with the Profile → Inventory view (js/progress.js) so equipping a
// theme/banner works identically from either place. `onDone` re-renders the
// caller's own view after a successful equip.
export async function equipTheme(t, onDone) {
  try {
    const { error } = await sb.from('user_settings')
      .upsert({ user_id: getUid(), equipped_theme: t.code }, { onConflict: 'user_id' });
    if (error) throw error;
    applyTheme(t.code);
    toast(`${t.name} equipped`, 'ok');
    onDone?.();
  } catch (ex) {
    toast(ex.message || 'Failed to equip', 'err');
  }
}

export async function equipBanner(b, onDone) {
  try {
    const { error } = await sb.from('user_settings')
      .upsert({ user_id: getUid(), equipped_banner: b.code }, { onConflict: 'user_id' });
    if (error) throw error;
    toast(`${b.name} equipped`, 'ok');
    onDone?.();
  } catch (ex) {
    toast(ex.message || 'Failed to equip', 'err');
  }
}

// Buys ONE unit of a booster into the inventory (stackable — repeat buys
// increment quantity). Spends Plates immediately; activation is a separate
// step (see activateOwnedBooster), shared with the Profile → Inventory view.
export async function buyBoosterItem(b, onDone) {
  try {
    const progress = await loadProgress();
    if (Number(progress.plates) < b.price) { toast('Not enough Plates', 'err'); return; }

    // Grant the inventory item BEFORE spending Plates — if this fails (e.g. a
    // schema mismatch), nothing is charged. Reversed order would risk paying
    // Plates for an item that then fails to grant.
    const uid = getUid();
    const { data: existing } = await sb.from('user_inventory')
      .select('id, quantity').eq('user_id', uid).eq('item_code', b.code).eq('item_type', 'booster').maybeSingle();
    if (existing) {
      const { error } = await sb.from('user_inventory')
        .update({ quantity: Number(existing.quantity) + 1 }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('user_inventory')
        .insert({ user_id: uid, item_code: b.code, item_type: 'booster', quantity: 1 });
      if (error) throw error;
    }

    const { error: pErr } = await sb.from('fitness_progress')
      .update({ plates: Number(progress.plates) - b.price }).eq('user_id', progress.user_id);
    if (pErr) throw pErr;

    toast(`${b.name} added to your inventory`, 'ok');
    onDone?.();
  } catch (ex) {
    toast(ex.message || 'Purchase failed', 'err');
  }
}

// Activates ONE owned unit of a booster: decrements inventory (deletes the
// row at 0) and sets the temporary XP multiplier read by progression.award().
// Blocked while another booster is already live — only one active at a time.
export async function activateOwnedBooster(b, onDone) {
  try {
    const uid = getUid();
    const { data: settings } = await sb.from('user_settings').select('active_booster').eq('user_id', uid).maybeSingle();
    const active = settings?.active_booster;
    if (active && new Date(active.expires_at) > new Date()) { toast('A booster is already active', 'err'); return; }

    const { data: owned, error: selErr } = await sb.from('user_inventory')
      .select('id, quantity').eq('user_id', uid).eq('item_code', b.code).eq('item_type', 'booster').maybeSingle();
    if (selErr) throw selErr;
    if (!owned || Number(owned.quantity) < 1) { toast(`No ${b.name} owned`, 'err'); return; }

    if (Number(owned.quantity) <= 1) {
      const { error } = await sb.from('user_inventory').delete().eq('id', owned.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('user_inventory').update({ quantity: Number(owned.quantity) - 1 }).eq('id', owned.id);
      if (error) throw error;
    }

    const expiresAt = new Date(Date.now() + b.durationMinutes * 60000).toISOString();
    const { error: sErr } = await sb.from('user_settings').upsert({
      user_id: uid, active_booster: { multiplier: b.multiplier, expires_at: expiresAt, code: b.code }
    }, { onConflict: 'user_id' });
    if (sErr) throw sErr;
    toast(`${b.name} activated! ⚡`, 'ok');
    onDone?.();
  } catch (ex) {
    toast(ex.message || 'Failed to activate', 'err');
  }
}
