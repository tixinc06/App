// Admin panel: edit your own level/Plates, and manage users (ban/unban,
// promote/demote admin). Every privileged write here is also enforced in
// Postgres — a guard trigger on `profiles` (see migration-admin.sql) blocks
// a non-admin from changing is_admin/banned/ban_reason on ANY row, including
// their own — this UI is a convenience layer, not the actual security
// boundary. Own level/Plates edits are NOT a new privilege at the DB level
// (fitness_progress already lets any user write their own row, since
// progression.award() runs client-side) — this just makes it a proper UI.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, toast, formModal, confirmModal, actionSheet, emptyState, skeleton, staggerChildren,
  openModal, closeModal
} from './ui.js';
import { loadOwnProfile, searchProfiles } from './profile.js';
import { loadProgress } from './progression.js';

let cachedIsAdmin = null;

// Cached for the session so the Home card / sections gate don't refetch on
// every render. Invalidated on self-demote so the UI reflects it immediately.
export async function isAdmin() {
  if (cachedIsAdmin !== null) return cachedIsAdmin;
  try {
    const profile = await loadOwnProfile();
    cachedIsAdmin = !!profile?.is_admin;
  } catch {
    cachedIsAdmin = false;
  }
  return cachedIsAdmin;
}

export function invalidateAdminCache() {
  cachedIsAdmin = null;
}

let adminView = 'progress'; // 'progress' | 'users'

export async function renderAdmin(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(3, 'item'));
  let progress;
  try {
    progress = await loadProgress();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load admin panel. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  container.append(el('div', { class: 'row', style: 'margin-bottom:16px;gap:8px' }, [
    el('button', {
      class: 'btn btn-sm ' + (adminView === 'progress' ? 'btn-primary' : 'btn-ghost'),
      onClick: () => { adminView = 'progress'; renderAdmin(container, root); }
    }, 'My Progress'),
    el('button', {
      class: 'btn btn-sm ' + (adminView === 'users' ? 'btn-primary' : 'btn-ghost'),
      onClick: () => { adminView = 'users'; renderAdmin(container, root); }
    }, 'Manage Users')
  ]));

  const body = el('div');
  container.append(body);

  if (adminView === 'users') {
    renderUserSearch(body, container, root);
  } else {
    renderOwnProgressCard(body, progress, container, root);
  }
}

// ── My Progress ──────────────────────────────────────────────────────────
function renderOwnProgressCard(body, progress, container, root) {
  body.append(el('div', { class: 'card', style: 'padding:18px' }, [
    el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'My Progress'),
    el('div', { style: 'display:flex;gap:28px;margin-top:10px' }, [
      el('div', {}, [
        el('div', { class: 'dim', style: 'font-size:11px' }, 'Level'),
        el('div', { style: 'font-size:24px;font-weight:800' }, String(progress.level))
      ]),
      el('div', {}, [
        el('div', { class: 'dim', style: 'font-size:11px' }, 'Plates'),
        el('div', { style: 'font-size:24px;font-weight:800;color:var(--amber)' }, num(progress.plates))
      ])
    ]),
    el('button', {
      class: 'btn btn-primary btn-sm', style: 'margin-top:16px',
      onClick: () => editOwnProgressForm(progress, container, root)
    }, 'Edit')
  ]));
}

function editOwnProgressForm(progress, container, root) {
  formModal({
    title: 'Edit my progress',
    fields: [
      { name: 'level', label: 'Level', type: 'number', step: '1', min: '1', required: true, value: progress.level },
      { name: 'plates', label: 'Plates', type: 'number', step: '1', min: '0', required: true, value: progress.plates }
    ],
    submitText: 'Save',
    onSubmit: async v => {
      const { error } = await sb.from('fitness_progress').update({
        level: Math.max(1, Math.round(v.level)),
        plates: Math.max(0, Math.round(v.plates))
      }).eq('user_id', getUid());
      if (error) throw error;
      toast('Progress updated', 'ok');
      renderAdmin(container, root);
    }
  });
}

// ── Manage Users ──────────────────────────────────────────────────────────
function renderUserSearch(body, container, root) {
  const input = el('input', { placeholder: 'Search username…', style: 'margin-top:0' });
  const results = el('div', { class: 'list', style: 'margin-top:12px' });
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim().toLowerCase();
    if (term.length < 2) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      let matches;
      try {
        matches = await searchProfiles(term, 15);
      } catch (ex) {
        results.innerHTML = '';
        results.append(emptyState('⚠️', ex.message));
        return;
      }
      results.innerHTML = '';
      if (!matches.length) { results.append(emptyState('🔍', 'No users found.')); return; }
      const list = el('div', { class: 'list' }, matches.map(m => userRow(m, container, root)));
      staggerChildren(list);
      results.append(list);
    }, 300);
  });

  body.append(input, results);
}

function userRow(m, container, root) {
  const statusBits = [];
  if (m.is_admin) statusBits.push('Admin');
  if (m.banned) statusBits.push('Banned');
  return el('div', { class: 'card item', onClick: () => userActions(m, container, root) }, [
    el('div', { class: 'thumb' }, m.is_admin ? '🛡️' : '🧑'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, '@' + m.username),
      el('div', { class: 'sub' }, statusBits.join(' · ') || 'Regular user')
    ])
  ]);
}

function userActions(m, container, root) {
  const acts = [];
  acts.push(m.is_admin
    ? { label: '🛡️ Remove admin', onClick: () => toggleAdmin(m, false, container, root) }
    : { label: '🛡️ Make admin', onClick: () => toggleAdmin(m, true, container, root) });
  acts.push(m.banned
    ? { label: '✅ Unban', onClick: () => unbanUser(m, container, root) }
    : { label: '🚫 Ban', danger: true, onClick: () => banForm(m, container, root) });
  acts.push({ label: '🗑️ Erase progress', danger: true, onClick: () => eraseForm(m, container, root) });
  actionSheet('@' + m.username, acts);
}

async function toggleAdmin(m, makeAdmin, container, root) {
  try {
    const { error } = await sb.from('profiles').update({ is_admin: makeAdmin }).eq('user_id', m.user_id);
    if (error) throw error;
    toast(makeAdmin ? `@${m.username} is now an admin` : `@${m.username} is no longer an admin`, 'ok');
    renderAdmin(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed', 'err');
  }
}

async function updateBanStatus(uid, banned, reason) {
  const { error } = await sb.from('profiles')
    .update({ banned, ban_reason: banned ? (reason || null) : null }).eq('user_id', uid);
  if (error) throw error;
}

function banForm(m, container, root) {
  formModal({
    title: 'Ban @' + m.username,
    fields: [{ name: 'ban_reason', label: 'Reason (optional)', type: 'textarea' }],
    submitText: 'Ban user',
    onSubmit: async v => {
      await updateBanStatus(m.user_id, true, v.ban_reason);
      toast(`@${m.username} banned`, 'ok');
      renderAdmin(container, root);
    }
  });
}

async function unbanUser(m, container, root) {
  try {
    await updateBanStatus(m.user_id, false, null);
    toast(`@${m.username} unbanned`, 'ok');
    renderAdmin(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed', 'err');
  }
}

// ── Erase progress ──────────────────────────────────────────────────────────
// Explicit, opt-in, per-area, irreversible. Never touches the profiles row —
// username, avatar, and ban state all survive. Separate action from ban/unban
// (which never touches data) — see admin_erase_user_data() in schema.sql.
function eraseForm(m, container, root) {
  const fitCb = el('input', { type: 'checkbox' });
  const resellCb = el('input', { type: 'checkbox' });
  const foodCb = el('input', { type: 'checkbox' });
  const err = el('p', { class: 'form-error', hidden: true });
  const btn = el('button', { class: 'btn btn-danger btn-block', style: 'margin-top:16px' }, 'Erase selected data');

  btn.addEventListener('click', () => {
    const wipeFitness = fitCb.checked, wipeReselling = resellCb.checked, wipeFood = foodCb.checked;
    if (!wipeFitness && !wipeReselling && !wipeFood) {
      err.textContent = 'Select at least one area.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const areas = [wipeFitness && 'fitness', wipeReselling && 'reselling', wipeFood && 'food'].filter(Boolean).join(', ');
    confirmModal({
      title: 'Erase progress?',
      message: `This permanently deletes @${m.username}'s ${areas} data. Their account, username, avatar, and ban status are not affected. This cannot be undone.`,
      confirmText: 'Erase',
      danger: true,
      onConfirm: async () => {
        const { error } = await sb.rpc('admin_erase_user_data', {
          target: m.user_id, wipe_fitness: wipeFitness, wipe_reselling: wipeReselling, wipe_food: wipeFood
        });
        if (error) throw error;
        toast(`Erased ${areas} data for @${m.username}`, 'ok');
        closeModal();
        renderAdmin(container, root);
      }
    });
  });

  openModal(el('div', {}, [
    el('h3', {}, 'Erase @' + m.username + "'s progress"),
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'Choose which areas to permanently wipe. This does not touch their account, username, avatar, or ban status.'),
    el('label', { class: 'row', style: 'align-items:center;gap:8px' }, [fitCb, 'Fitness — workouts, PRs, XP, quests, achievements…']),
    el('label', { class: 'row', style: 'align-items:center;gap:8px;margin-top:10px' }, [resellCb, 'Reselling — inventory, sales, goals, catalog…']),
    el('label', { class: 'row', style: 'align-items:center;gap:8px;margin-top:10px' }, [foodCb, 'Food — library, logs']),
    err,
    btn
  ]));
}
