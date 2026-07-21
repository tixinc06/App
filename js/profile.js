// Shared identity + friends core: username claim/lookup, friend search, and
// friend request send/respond/remove. One app-wide layer used by the
// mandatory username gate (js/app.js), the signup form (js/auth.js), the
// Fitness Friends tab (js/social.js), and the Reselling Goals tab
// (js/resellgoals.js) — usernames and friendships are shared across every
// section, not owned by any one of them.
import { sb } from './supabase.js';
import { getUid } from './auth.js';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function loadOwnProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', getUid()).maybeSingle();
  if (error) throw error;
  return data;
}

// Creates a profile row for the first time. `uid` can be passed explicitly
// (needed right after signUp(), before the auth-state-change listener has
// necessarily updated the cached session) — defaults to the current session.
export async function claimUsername(rawUsername, { uid, displayName } = {}) {
  const targetUid = uid || getUid();
  const username = (rawUsername || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new Error('3-20 characters: lowercase letters, numbers, underscore.');
  const { error } = await sb.from('profiles')
    .insert({ user_id: targetUid, username, display_name: displayName || null });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('That username is taken.');
    throw error;
  }
  return username;
}

export async function updateProfile(rawUsername, displayName) {
  const username = (rawUsername || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new Error('3-20 characters: lowercase letters, numbers, underscore.');
  const { error } = await sb.from('profiles')
    .update({ username, display_name: displayName || null }).eq('user_id', getUid());
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('That username is taken.');
    throw error;
  }
  return username;
}

export async function searchProfiles(term, limit = 10) {
  const uid = getUid();
  const { data, error } = await sb.from('profiles')
    .select('*').ilike('username', `%${term}%`).neq('user_id', uid).limit(limit);
  if (error) throw error;
  return data || [];
}

// Every friendship row involving the current user, split by state, plus a
// profileById lookup for the OTHER party on each row. Callers that need
// section-specific data per friend (fitness progress, reselling month
// profit…) fetch that separately using the ids in profileById.
export async function loadFriendships() {
  const uid = getUid();
  const { data: rows, error } = await sb.from('friendships')
    .select('*').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`);
  if (error) throw error;

  const accepted = (rows || []).filter(r => r.status === 'accepted');
  const incoming = (rows || []).filter(r => r.status === 'pending' && r.addressee_id === uid);
  const outgoing = (rows || []).filter(r => r.status === 'pending' && r.requester_id === uid);

  const otherIds = [...new Set([...accepted, ...incoming, ...outgoing].map(r => otherIdOf(r, uid)))];

  let profileById = {};
  if (otherIds.length) {
    const { data: profs, error: pErr } = await sb.from('profiles').select('*').in('user_id', otherIds);
    if (pErr) throw pErr;
    for (const p of (profs || [])) profileById[p.user_id] = p;
  }
  return { accepted, incoming, outgoing, profileById };
}

export function otherIdOf(friendship, uid) {
  return friendship.requester_id === uid ? friendship.addressee_id : friendship.requester_id;
}

export async function sendFriendRequest(addresseeId) {
  const { error } = await sb.from('friendships').insert({ requester_id: getUid(), addressee_id: addresseeId });
  if (error) throw error;
}

export async function respondFriendRequest(friendshipId, accept) {
  if (accept) {
    const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    if (error) throw error;
  } else {
    const { error } = await sb.from('friendships').delete().eq('id', friendshipId);
    if (error) throw error;
  }
}

export async function removeFriendship(otherUid) {
  const uid = getUid();
  const { error } = await sb.from('friendships').delete()
    .or(`and(requester_id.eq.${uid},addressee_id.eq.${otherUid}),and(requester_id.eq.${otherUid},addressee_id.eq.${uid})`);
  if (error) throw error;
}
