// Friends & social: a public username per user, friend requests, a
// level/prestige leaderboard, viewing a friend's open goals, and sharing
// workout templates (a friend can copy one of your shared templates to
// their own planner). No push notifications — this is a pull/refresh model,
// consistent with the rest of the static-PWA architecture.
//
// Identity + friend-request plumbing (usernames, search, send/respond/remove)
// lives in js/profile.js and is shared with the Reselling Goals tab — this
// file only adds the Fitness-specific views (leaderboard, friend detail).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, toast, formModal, confirmModal, emptyState,
  skeleton, staggerChildren, openModal, closeModal
} from './ui.js';
import {
  loadOwnProfile, claimUsername, updateProfile, searchProfiles,
  loadFriendships, otherIdOf, sendFriendRequest, respondFriendRequest, removeFriendship
} from './profile.js';

let friendsView = 'friends'; // 'friends' | 'requests' | 'leaderboard' | 'add'

async function loadSocialData() {
  const { accepted, incoming, outgoing, profileById } = await loadFriendships();
  const otherIds = Object.keys(profileById);

  let progressById = {};
  if (otherIds.length) {
    const { data: progs, error } = await sb.from('fitness_progress').select('*').in('user_id', otherIds);
    if (error) throw error;
    for (const p of (progs || [])) progressById[p.user_id] = p;
  }
  return { accepted, incoming, outgoing, profileById, progressById };
}

export async function renderFriends(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(3, 'item'));
  let profile;
  try {
    profile = await loadOwnProfile();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load Friends. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  if (!profile) {
    container.append(usernameSetupCard(container, root));
    return;
  }

  let data;
  try {
    data = await loadSocialData();
  } catch (ex) {
    container.append(emptyState('⚠️', 'Could not load friends. ' + (ex.message || '')));
    return;
  }

  container.append(el('div', { class: 'card', style: 'padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between' }, [
    el('div', {}, [
      el('div', { class: 'dim', style: 'font-size:11px;text-transform:uppercase;font-weight:600' }, 'You'),
      el('div', { style: 'font-weight:700' }, '@' + profile.username)
    ]),
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => editProfileForm(profile, container, root) }, 'Edit')
  ]));

  const tabs = [
    { value: 'friends', label: `Friends (${data.accepted.length})` },
    { value: 'requests', label: `Requests${data.incoming.length ? ` (${data.incoming.length})` : ''}` },
    { value: 'leaderboard', label: 'Leaderboard' },
    { value: 'add', label: '＋ Add' }
  ];
  const tabRow = el('div', { class: 'row', style: 'margin-bottom:16px;flex-wrap:wrap;gap:8px' },
    tabs.map(t => el('button', {
      class: 'btn btn-sm ' + (friendsView === t.value ? 'btn-primary' : 'btn-ghost'),
      onClick: () => { friendsView = t.value; renderFriends(container, root); }
    }, t.label)));
  container.append(tabRow);

  const body = el('div');
  container.append(body);

  if (friendsView === 'requests') {
    renderRequests(body, data, container, root);
  } else if (friendsView === 'leaderboard') {
    renderLeaderboard(body, data);
  } else if (friendsView === 'add') {
    renderAddFriend(body, data, container, root);
  } else {
    renderFriendsList(body, data, container, root);
  }
}

function usernameSetupCard(container, root) {
  const input = el('input', { placeholder: 'e.g. jordan92', style: 'margin-top:0' });
  const err = el('p', { class: 'form-error', hidden: true });
  const btn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:12px' }, 'Claim username');
  btn.addEventListener('click', async () => {
    err.hidden = true; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await claimUsername(input.value);
      toast('Username set 👋', 'ok');
      renderFriends(container, root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; btn.disabled = false; btn.textContent = 'Claim username';
    }
  });
  return el('div', { class: 'card', style: 'padding:20px' }, [
    el('div', { style: 'font-size:30px;text-align:center;margin-bottom:8px' }, '👋'),
    el('div', { style: 'font-weight:700;text-align:center;margin-bottom:4px' }, 'Pick a username'),
    el('div', { class: 'muted', style: 'text-align:center;margin-bottom:14px' }, 'Friends will find you by this — it can\'t be changed often, choose carefully.'),
    input, err, btn
  ]);
}

function editProfileForm(profile, container, root) {
  formModal({
    title: 'Edit profile',
    fields: [
      { name: 'username', label: 'Username', value: profile.username, required: true },
      { name: 'display_name', label: 'Display name (optional)', value: profile.display_name || '' }
    ],
    submitText: 'Save',
    onSubmit: async v => {
      await updateProfile(v.username, v.display_name);
      toast('Saved', 'ok');
      renderFriends(container, root);
    }
  });
}

function levelBadge(progress) {
  if (!progress) return el('span', { class: 'pill' }, '—');
  const label = progress.is_master ? `Master · Lv${progress.level}` : `P${progress.prestige} · Lv${progress.level}`;
  return el('span', { class: 'pill' }, label);
}

function renderFriendsList(body, data, container, root) {
  if (!data.accepted.length) {
    body.append(emptyState('🤝', 'No friends yet — add one by username.'));
    return;
  }
  const list = el('div', { class: 'list' }, data.accepted.map(f => {
    const uid = getUid();
    const oid = otherIdOf(f, uid);
    const prof = data.profileById[oid];
    const prog = data.progressById[oid];
    return el('div', { class: 'card item', onClick: () => openFriendDetail(oid, prof, prog, container, root) }, [
      el('div', { class: 'thumb' }, '🧑'),
      el('div', { class: 'grow' }, [
        el('div', { class: 'title' }, '@' + (prof?.username || 'unknown')),
        el('div', { class: 'sub' }, prof?.display_name || '')
      ]),
      levelBadge(prog)
    ]);
  }));
  staggerChildren(list);
  body.append(list);
}

function renderRequests(body, data, container, root) {
  if (data.incoming.length) {
    body.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Incoming')]));
    const list = el('div', { class: 'list', style: 'margin-bottom:16px' }, data.incoming.map(f => {
      const prof = data.profileById[f.requester_id];
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb' }, '🧑'),
        el('div', { class: 'grow' }, [el('div', { class: 'title' }, '@' + (prof?.username || 'unknown'))]),
        el('div', { class: 'row', style: 'flex:0 0 auto;gap:6px' }, [
          el('button', { class: 'btn btn-sm btn-primary', onClick: () => respondRequest(f, true, container, root) }, 'Accept'),
          el('button', { class: 'btn btn-sm btn-ghost', onClick: () => respondRequest(f, false, container, root) }, 'Decline')
        ])
      ]);
    }));
    staggerChildren(list);
    body.append(list);
  }
  if (data.outgoing.length) {
    body.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Sent')]));
    const list = el('div', { class: 'list' }, data.outgoing.map(f => {
      const prof = data.profileById[f.addressee_id];
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb' }, '🧑'),
        el('div', { class: 'grow' }, [el('div', { class: 'title' }, '@' + (prof?.username || 'unknown')), el('div', { class: 'sub' }, 'Pending')]),
        el('button', { class: 'btn btn-sm btn-ghost', onClick: () => cancelRequest(f, container, root) }, 'Cancel')
      ]);
    }));
    staggerChildren(list);
    body.append(list);
  }
  if (!data.incoming.length && !data.outgoing.length) {
    body.append(emptyState('📬', 'No pending requests.'));
  }
}

async function respondRequest(f, accept, container, root) {
  try {
    await respondFriendRequest(f.id, accept);
    toast(accept ? 'Friend added 🤝' : 'Declined', accept ? 'ok' : '');
    renderFriends(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed', 'err');
  }
}

function cancelRequest(f, container, root) {
  confirmModal({
    title: 'Cancel request?', confirmText: 'Cancel request',
    onConfirm: async () => {
      await respondFriendRequest(f.id, false);
      renderFriends(container, root);
    }
  });
}

function renderLeaderboard(body, data) {
  const uid = getUid();
  // My own progress isn't in progressById (that's only fetched for friends) —
  // fetch it lazily below since the leaderboard is the only place that needs it.
  const rows = [
    ...data.accepted.map(f => {
      const oid = otherIdOf(f, uid);
      return { id: oid, label: '@' + (data.profileById[oid]?.username || 'unknown'), prog: data.progressById[oid] };
    })
  ];
  loadOwnProgressForLeaderboard().then(myProg => {
    rows.push({ id: uid, label: 'You', prog: myProg, isMe: true });
    rankAndRender(rows, body);
  }).catch(() => rankAndRender(rows, body));
}

async function loadOwnProgressForLeaderboard() {
  const { data } = await sb.from('fitness_progress').select('*').eq('user_id', getUid()).maybeSingle();
  return data;
}

function rankAndRender(rows, body) {
  const ranked = rows
    .filter(r => r.prog)
    .sort((a, b) => {
      const A = a.prog, B = b.prog;
      if (A.is_master !== B.is_master) return A.is_master ? -1 : 1;
      if (A.prestige !== B.prestige) return B.prestige - A.prestige;
      if (A.level !== B.level) return B.level - A.level;
      return Number(B.lifetime_xp) - Number(A.lifetime_xp);
    });
  body.innerHTML = '';
  if (!ranked.length) {
    body.append(emptyState('🏆', 'Add friends to see a leaderboard.'));
    return;
  }
  const list = el('div', { class: 'list' }, ranked.map((r, i) =>
    el('div', { class: 'card item' + (r.isMe ? ' active' : '') }, [
      el('div', { class: 'thumb' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`),
      el('div', { class: 'grow' }, [
        el('div', { class: 'title' }, r.label),
        el('div', { class: 'sub' }, `${num(r.prog.lifetime_xp)} lifetime XP`)
      ]),
      levelBadge(r.prog)
    ])));
  staggerChildren(list);
  body.append(list);
}

function renderAddFriend(body, data, container, root) {
  const uid = getUid();
  const knownIds = new Set([
    ...data.accepted.map(f => otherIdOf(f, uid)),
    ...data.incoming.map(f => otherIdOf(f, uid)),
    ...data.outgoing.map(f => otherIdOf(f, uid))
  ]);
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
        matches = await searchProfiles(term);
      } catch (ex) {
        results.innerHTML = '';
        results.append(emptyState('⚠️', ex.message));
        return;
      }
      results.innerHTML = '';
      if (!matches.length) { results.append(emptyState('🔍', 'No users found.')); return; }
      results.append(...matches.map(m => {
        const already = knownIds.has(m.user_id);
        return el('div', { class: 'card item' }, [
          el('div', { class: 'thumb' }, '🧑'),
          el('div', { class: 'grow' }, [el('div', { class: 'title' }, '@' + m.username)]),
          already
            ? el('span', { class: 'pill' }, 'Already added')
            : el('button', {
                class: 'btn btn-sm btn-primary',
                onClick: async e => {
                  e.target.disabled = true; e.target.textContent = 'Sending…';
                  try {
                    await sendFriendRequest(m.user_id);
                    toast('Request sent', 'ok');
                    friendsView = 'requests';
                    renderFriends(container, root);
                  } catch (ex) {
                    toast(ex.message || 'Failed to send', 'err');
                    e.target.disabled = false; e.target.textContent = 'Add';
                  }
                }
              }, 'Add')
        ]);
      }));
    }, 300);
  });

  body.append(input, results);
}

async function openFriendDetail(oid, prof, prog, container, root) {
  openModal(el('div', {}, [el('h3', {}, '@' + (prof?.username || 'unknown')), skeleton(3, 'item')]));
  let goals = [], templates = [];
  try {
    const [{ data: g }, { data: t }] = await Promise.all([
      sb.from('fitness_goals').select('*').eq('user_id', oid).order('created_at', { ascending: false }),
      sb.from('workout_templates').select('*').eq('user_id', oid).eq('is_shared', true)
    ]);
    goals = g || []; templates = t || [];
  } catch { /* best-effort — friend detail still shows what loaded */ }

  const openGoals = goals.filter(g => !g.achieved);

  const body = el('div', {}, [
    el('h3', {}, '@' + (prof?.username || 'unknown')),
    el('div', { style: 'margin:10px 0 16px' }, [levelBadge(prog)]),
    el('div', { class: 'section-head' }, [el('h2', {}, 'Goals')]),
    openGoals.length
      ? el('div', { class: 'list', style: 'margin-bottom:16px' }, openGoals.map(g =>
          el('div', { class: 'card item' }, [
            el('div', { class: 'thumb' }, '🎯'),
            el('div', { class: 'grow' }, [el('div', { class: 'title' }, `${g.exercise} — ${num(g.target_weight)}kg${g.target_reps > 1 ? ` ×${g.target_reps}` : ''}`)])
          ])))
      : el('div', { class: 'muted', style: 'margin-bottom:16px' }, 'No open goals.'),
    el('div', { class: 'section-head' }, [el('h2', {}, 'Shared plans')]),
    templates.length
      ? el('div', { class: 'list', style: 'margin-bottom:16px' }, templates.map(t =>
          el('div', { class: 'card item' }, [
            el('div', { class: 'thumb' }, '📋'),
            el('div', { class: 'grow' }, [
              el('div', { class: 'title' }, t.name),
              el('div', { class: 'sub' }, `${(t.exercises || []).length} exercises`)
            ]),
            el('button', { class: 'btn btn-sm btn-primary', onClick: () => copyTemplate(t, root) }, 'Copy')
          ])))
      : el('div', { class: 'muted', style: 'margin-bottom:16px' }, 'No shared plans.'),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-danger', onClick: () => removeFriend(oid, container, root) }, 'Remove friend'),
      el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close')
    ])
  ]);
  openModal(body);
}

async function copyTemplate(t, root) {
  try {
    const { error } = await sb.from('workout_templates')
      .insert({ user_id: getUid(), name: t.name, exercises: t.exercises, is_shared: false });
    if (error) throw error;
    toast('Copied to your templates', 'ok');
  } catch (ex) {
    toast(ex.message || 'Failed to copy', 'err');
  }
}

function removeFriend(oid, container, root) {
  confirmModal({
    title: 'Remove friend?', confirmText: 'Remove',
    onConfirm: async () => {
      await removeFriendship(oid);
      closeModal();
      toast('Removed');
      renderFriends(container, root);
    }
  });
}
