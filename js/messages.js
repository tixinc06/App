// Friend messaging: a conversation list (one per accepted friend, with an
// unread badge) and a live chat modal — new messages appear instantly via
// Supabase Realtime while the chat is open. A "＋" attach sheet lets you
// share a product/workout/meal as a snapshot attachment (survives the
// original being edited/deleted later, same idea as the existing "copy a
// shared template" flow in js/social.js); the recipient gets a "Save to
// mine" button that imports it into their own library.
//
// Honest caveat: Realtime only delivers while the app is open — there is no
// lock-screen/background push in a static PWA.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, toast, formModal, emptyState, skeleton, staggerChildren, openModal, actionSheet
} from './ui.js';
import { loadFriendships, otherIdOf } from './profile.js';
import { renderAvatar } from './avatar.js';

// ── Conversation list ────────────────────────────────────────────────────────
async function loadConversations() {
  const uid = getUid();
  const { accepted, profileById } = await loadFriendships();
  if (!accepted.length) return [];

  const otherIds = accepted.map(f => otherIdOf(f, uid));
  const { data: msgs, error } = await sb.from('messages')
    .select('*').or(`sender_id.eq.${uid},recipient_id.eq.${uid}`).order('created_at', { ascending: false });
  if (error) throw error;

  const byOther = {};
  for (const oid of otherIds) byOther[oid] = { last: null, unread: 0 };
  for (const m of (msgs || [])) {
    const other = m.sender_id === uid ? m.recipient_id : m.sender_id;
    if (!(other in byOther)) continue;
    if (!byOther[other].last) byOther[other].last = m;
    if (m.recipient_id === uid && !m.read_at) byOther[other].unread++;
  }
  return otherIds
    .map(oid => ({ oid, profile: profileById[oid], ...byOther[oid] }))
    .sort((a, b) => new Date(b.last?.created_at || 0) - new Date(a.last?.created_at || 0));
}

function previewText(m) {
  if (!m) return 'Say hi 👋';
  if (m.attachment) return `📎 Shared a ${m.attachment.kind}`;
  return (m.body || '').slice(0, 60);
}

export async function renderConversations(container, root) {
  container.innerHTML = '';
  container.append(skeleton(3, 'item'));
  let conversations;
  try {
    conversations = await loadConversations();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load messages. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';
  if (!conversations.length) {
    container.append(emptyState('💬', 'Add a friend to start messaging.'));
    return;
  }
  const list = el('div', { class: 'list' }, conversations.map(c => el('div', {
    class: 'card item', onClick: () => openConversation(c.oid, c.profile, container, root)
  }, [
    el('div', { class: 'thumb avatar-thumb' }, [renderAvatar(c.profile, { size: 46 })]),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, '@' + (c.profile?.username || 'unknown')),
      el('div', { class: 'sub' }, previewText(c.last))
    ]),
    c.unread ? el('span', { class: 'pill' }, String(c.unread)) : null
  ])));
  staggerChildren(list);
  container.append(list);
}

// ── Sending ──────────────────────────────────────────────────────────────────
// Returns the inserted row so the sender's own chat can append it
// immediately — Realtime also delivers it back to the sender, but that can
// lag (or not be configured), and a sent message should appear right away
// regardless. appendMessage() dedupes by id, so no double-bubble either way.
async function sendMessage(recipientId, body, attachment) {
  const { data, error } = await sb.from('messages')
    .insert({ sender_id: getUid(), recipient_id: recipientId, body: body || '', attachment: attachment || null })
    .select().single();
  if (error) throw error;
  return data;
}

// ── Attach sheet: share a product / workout / meal ───────────────────────────
// `onSent(message)` lets the open conversation append the sent message
// immediately (same reasoning as sendMessage's return value above).
function openAttachSheet(recipientId, onSent) {
  actionSheet('Share', [
    { label: '📦 Share a product', onClick: () => shareProductPicker(recipientId, onSent) },
    { label: '🏋️ Share a workout', onClick: () => shareWorkoutPicker(recipientId, onSent) },
    { label: '🍽️ Share a meal', onClick: () => shareMealPicker(recipientId, onSent) }
  ]);
}

async function shareProductPicker(recipientId, onSent) {
  const { data, error } = await sb.from('product_catalog').select('*').eq('user_id', getUid());
  if (error) { toast(error.message, 'err'); return; }
  if (!data.length) { toast('No products in your catalog yet', ''); return; }
  formModal({
    title: 'Share a product',
    fields: [{ name: 'item_id', label: 'Product', type: 'select', options: data.map(p => ({ value: p.id, label: p.name })) }],
    submitText: 'Send',
    onSubmit: async v => {
      const p = data.find(x => x.id === v.item_id);
      const m = await sendMessage(recipientId, '', {
        kind: 'product',
        payload: { name: p.name, image_url: p.image_url, product_url: p.product_url, default_cost: p.default_cost, category: p.category }
      });
      onSent?.(m);
      toast('Sent', 'ok');
    }
  });
}

async function shareWorkoutPicker(recipientId, onSent) {
  const { data, error } = await sb.from('workout_templates').select('*').eq('user_id', getUid());
  if (error) { toast(error.message, 'err'); return; }
  if (!data.length) { toast('No workout templates yet', ''); return; }
  formModal({
    title: 'Share a workout',
    fields: [{ name: 'item_id', label: 'Template', type: 'select', options: data.map(t => ({ value: t.id, label: t.name })) }],
    submitText: 'Send',
    onSubmit: async v => {
      const t = data.find(x => x.id === v.item_id);
      const m = await sendMessage(recipientId, '', { kind: 'workout', payload: { name: t.name, exercises: t.exercises } });
      onSent?.(m);
      toast('Sent', 'ok');
    }
  });
}

async function shareMealPicker(recipientId, onSent) {
  const { data, error } = await sb.from('foods').select('*').eq('user_id', getUid());
  if (error) { toast(error.message, 'err'); return; }
  if (!data.length) { toast('No foods in your library yet', ''); return; }
  formModal({
    title: 'Share a meal',
    fields: [{ name: 'item_id', label: 'Food', type: 'select', options: data.map(f => ({ value: f.id, label: f.name })) }],
    submitText: 'Send',
    onSubmit: async v => {
      const f = data.find(x => x.id === v.item_id);
      const m = await sendMessage(recipientId, '', {
        kind: 'meal',
        payload: { name: f.name, serving_desc: f.serving_desc, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat }
      });
      onSent?.(m);
      toast('Sent', 'ok');
    }
  });
}

// ── Receiving: "Save to mine" imports a snapshot into the recipient's own data ──
async function saveAttachment(att) {
  try {
    const uid = getUid();
    const p = att.payload;
    if (att.kind === 'product') {
      const { error } = await sb.from('product_catalog').insert({
        user_id: uid, name: p.name, image_url: p.image_url, product_url: p.product_url,
        default_cost: p.default_cost, category: p.category, is_shared: false
      });
      if (error) throw error;
    } else if (att.kind === 'workout') {
      const { error } = await sb.from('workout_templates').insert({ user_id: uid, name: p.name, exercises: p.exercises });
      if (error) throw error;
    } else if (att.kind === 'meal') {
      const { error } = await sb.from('foods').insert({
        user_id: uid, name: p.name, serving_desc: p.serving_desc, calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat
      });
      if (error) throw error;
    }
    toast('Saved to yours', 'ok');
  } catch (ex) {
    toast(ex.message || 'Failed to save', 'err');
  }
}

function attachmentCard(att, mine) {
  const p = att.payload || {};
  const icon = att.kind === 'product' ? '📦' : att.kind === 'workout' ? '🏋️' : '🍽️';
  const sub = att.kind === 'product' ? (p.category || 'Product')
    : att.kind === 'workout' ? `${(p.exercises || []).length} exercises`
    : `${num(p.calories)} cal per serving`;
  return el('div', { class: 'card item chat-attachment' }, [
    el('div', { class: 'thumb' }, icon),
    el('div', { class: 'grow' }, [el('div', { class: 'title' }, p.name || 'Shared item'), el('div', { class: 'sub' }, sub)]),
    !mine ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => saveAttachment(att) }, 'Save to mine') : null
  ]);
}

// ── Chat modal (live via Realtime while open) ────────────────────────────────
export function openConversation(otherUid, otherProfile, listContainer, root) {
  const uid = getUid();
  const renderedIds = new Set();
  const msgList = el('div', { class: 'chat-messages' });

  function bubble(m) {
    const mine = m.sender_id === uid;
    const content = m.attachment ? attachmentCard(m.attachment, mine) : el('div', { class: 'chat-bubble' }, m.body);
    return el('div', { class: 'chat-bubble-row' + (mine ? ' mine' : '') }, [content]);
  }

  function appendMessage(m) {
    if (renderedIds.has(m.id)) return;
    renderedIds.add(m.id);
    msgList.append(bubble(m));
    msgList.scrollTop = msgList.scrollHeight;
  }

  const bodyInput = el('input', { placeholder: 'Message…', style: 'margin-top:0' });
  // The attach sheet/picker are separate modals — openModal() replaces the
  // single #modal-host wholesale, so the chat view underneath is gone once
  // they open. Tear this conversation's channel down explicitly and reopen
  // it fresh after a successful send, rather than relying on the "hidden"
  // MutationObserver below (which never fires for a same-modal replacement,
  // since the host stays visible throughout — that would leak this channel).
  const attachBtn = el('button', {
    type: 'button', class: 'btn btn-sm btn-ghost',
    onClick: () => openAttachSheet(otherUid, () => {
      teardown();
      // formModal calls its own closeModal() right after onSubmit resolves
      // (which is where onSent fires) — reopening synchronously here would
      // just get closed again a tick later. Deferring runs this after that.
      setTimeout(() => openConversation(otherUid, otherProfile, listContainer, root), 0);
    })
  }, '＋');
  const sendBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: doSend }, 'Send');

  async function doSend() {
    const text = bodyInput.value.trim();
    if (!text) return;
    bodyInput.value = '';
    try {
      const m = await sendMessage(otherUid, text, null);
      appendMessage(m);
    } catch (ex) {
      toast(ex.message || 'Failed to send', 'err');
    }
  }
  bodyInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

  const channel = sb.channel(`messages-${uid}-${otherUid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      const m = payload.new;
      const isThisConvo = (m.sender_id === otherUid && m.recipient_id === uid) || (m.sender_id === uid && m.recipient_id === otherUid);
      if (isThisConvo) {
        appendMessage(m);
        if (m.recipient_id === uid) sb.from('messages').update({ read_at: new Date().toISOString() }).eq('id', m.id).then(() => {});
      }
    })
    .subscribe();

  let tornDown = false;
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    sb.removeChannel(channel);
    observer.disconnect();
  }

  const host = document.getElementById('modal-host');
  const observer = new MutationObserver(() => {
    if (host.hidden) {
      teardown();
      if (listContainer) renderConversations(listContainer, root); // refresh unread badges on close
    }
  });
  observer.observe(host, { attributes: true, attributeFilter: ['hidden'] });

  openModal(el('div', { class: 'chat-modal' }, [
    el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:10px' }, [
      renderAvatar(otherProfile, { size: 36 }),
      el('h3', { style: 'margin:0' }, '@' + (otherProfile?.username || 'unknown'))
    ]),
    msgList,
    el('div', { class: 'row', style: 'gap:6px;margin-top:10px' }, [attachBtn, bodyInput, sendBtn])
  ]));

  loadHistory();
  async function loadHistory() {
    const { data, error } = await sb.from('messages')
      .select('*')
      .or(`and(sender_id.eq.${uid},recipient_id.eq.${otherUid}),and(sender_id.eq.${otherUid},recipient_id.eq.${uid})`)
      .order('created_at', { ascending: true });
    if (error) { toast(error.message, 'err'); return; }
    for (const m of (data || [])) appendMessage(m);
    const unreadIds = (data || []).filter(m => m.recipient_id === uid && !m.read_at).map(m => m.id);
    if (unreadIds.length) await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
  }
}

// Best-effort total unread count, for badging the Friends/Messages entry
// points. Never throws — a failed count just shows no badge.
export async function loadUnreadCount() {
  try {
    const { count, error } = await sb.from('messages')
      .select('id', { count: 'exact', head: true }).eq('recipient_id', getUid()).is('read_at', null);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}
