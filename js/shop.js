// Shop tab: spend Plates on themes (app-wide recolour), banners (cosmetic
// flair on the Progress tab), and instant-use XP boosters.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, toast, emptyState, skeleton, staggerChildren, segmented } from './ui.js';
import { loadProgress } from './progression.js';
import { SHOP_ITEMS } from './gamedata.js';
import { applyTheme } from './theme.js';

let shopTab = 'themes'; // 'themes' | 'banners' | 'boosters'

async function loadShopState() {
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

  container.append(el('div', {
    class: 'card', style: 'padding:16px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between'
  }, [
    el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Your Plates'),
    el('div', { style: 'font-size:22px;font-weight:800;color:var(--amber)' }, num(state.progress.plates))
  ]));

  container.append(segmented([
    { value: 'themes', label: 'Themes' },
    { value: 'banners', label: 'Banners' },
    { value: 'boosters', label: 'Boosters' }
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
      onEquip: () => equipTheme(t, container, root)
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
      onEquip: () => equipBanner(b, container, root)
    })
  ]);
}

function boosterRow(b, state, activeLive, container, root) {
  const canAfford = state.progress.plates >= b.price;
  const disabled = !canAfford || activeLive;
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '⚡'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, b.name),
      el('div', { class: 'sub' }, `${b.multiplier}× XP for ${b.durationMinutes} min`)
    ]),
    el('button', {
      class: 'btn btn-sm ' + (!disabled ? 'btn-primary' : 'btn-ghost'),
      disabled,
      onClick: () => activateBooster(b, container, root)
    }, activeLive ? 'Active…' : (canAfford ? `Activate · ${num(b.price)}` : `Need ${num(b.price)}`))
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

async function equipTheme(t, container, root) {
  try {
    const { error } = await sb.from('user_settings')
      .upsert({ user_id: getUid(), equipped_theme: t.code }, { onConflict: 'user_id' });
    if (error) throw error;
    applyTheme(t.code);
    toast(`${t.name} equipped`, 'ok');
    renderShop(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to equip', 'err');
  }
}

async function equipBanner(b, container, root) {
  try {
    const { error } = await sb.from('user_settings')
      .upsert({ user_id: getUid(), equipped_banner: b.code }, { onConflict: 'user_id' });
    if (error) throw error;
    toast(`${b.name} equipped`, 'ok');
    renderShop(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to equip', 'err');
  }
}

async function activateBooster(b, container, root) {
  try {
    const progress = await loadProgress();
    if (Number(progress.plates) < b.price) { toast('Not enough Plates', 'err'); return; }
    const { error: pErr } = await sb.from('fitness_progress')
      .update({ plates: Number(progress.plates) - b.price }).eq('user_id', progress.user_id);
    if (pErr) throw pErr;
    const expiresAt = new Date(Date.now() + b.durationMinutes * 60000).toISOString();
    const { error: sErr } = await sb.from('user_settings').upsert({
      user_id: getUid(), active_booster: { multiplier: b.multiplier, expires_at: expiresAt, code: b.code }
    }, { onConflict: 'user_id' });
    if (sErr) throw sErr;
    toast(`${b.name} activated! ⚡`, 'ok');
    renderShop(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to activate', 'err');
  }
}
