// Progress photos: private by default (a private storage bucket, signed
// URLs — mirrors the pattern in js/resell.js), with a per-photo opt-in
// "Share to a friend" that copies just that one image into a PUBLIC bucket
// (an explicit, deliberate copy — never the private original) and sends it
// as a chat attachment via js/messages.js.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, todayISO, toast, formModal, confirmModal, actionSheet, emptyState,
  skeleton, staggerChildren, openModal, closeModal
} from './ui.js';
import { loadFriendships, otherIdOf } from './profile.js';
import { sendPhotoMessage } from './messages.js';
import { weightUnit, displayToKg, fmtWeight, weightStep } from './units.js';

const PRIVATE_BUCKET = 'progress-photos';
const SHARE_BUCKET = 'progress-shares';

async function loadPhotos() {
  const { data, error } = await sb.from('progress_photos')
    .select('*').eq('user_id', getUid()).order('taken_on', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function signedUrl(path) {
  const { data } = await sb.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function renderPhotos(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(3, 'item'));
  let photos;
  try {
    photos = await loadPhotos();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load photos. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  const actionsRow = el('div', { class: 'row', style: 'gap:8px;margin-bottom:18px' }, [
    el('button', { class: 'btn btn-primary', style: 'flex:1', onClick: () => uploadForm(root, container) }, '📸 Add photo'),
    photos.length >= 2 ? el('button', { class: 'btn btn-ghost', onClick: () => compareView(photos, root) }, 'Compare') : null
  ]);
  container.append(actionsRow);

  if (!photos.length) {
    container.append(emptyState('📸', 'No progress photos yet.'));
    return;
  }

  const grid = el('div', { class: 'photo-grid' });
  container.append(grid);
  staggerChildren(grid);
  for (const p of photos) {
    const img = el('img', { class: 'photo-thumb', alt: '' });
    const cell = el('div', { class: 'photo-cell', onClick: () => detailView(p, root, container) }, [
      img,
      el('div', { class: 'photo-date' }, fmtDate(p.taken_on))
    ]);
    grid.append(cell);
    signedUrl(p.storage_path).then(url => { if (url) img.src = url; });
  }
}

function uploadForm(root, container) {
  const fileInput = el('input', { type: 'file', accept: 'image/*', required: true });
  const dateInput = el('input', { type: 'date', value: todayISO(), style: 'margin-top:0' });
  const weightInput = el('input', { type: 'number', step: String(weightStep()), min: '0', placeholder: `optional (${weightUnit()})`, style: 'margin-top:0' });
  const noteInput = el('textarea', { placeholder: 'Note (optional)' });
  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, 'Save photo');

  saveBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) { err.textContent = 'Choose a photo.'; err.hidden = false; return; }
    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Uploading…';
    try {
      const uid = getUid();
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await sb.storage.from(PRIVATE_BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { error } = await sb.from('progress_photos').insert({
        user_id: uid, taken_on: dateInput.value || todayISO(),
        storage_path: path,
        weight: weightInput.value === '' ? null : displayToKg(weightInput.value),
        note: noteInput.value.trim()
      });
      if (error) throw error;
      closeModal();
      toast('Photo saved', 'ok');
      renderPhotos(container, root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Save photo';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, 'Add progress photo'),
    el('label', {}, ['Photo', fileInput]),
    el('label', {}, ['Date', dateInput]),
    el('label', {}, [`Bodyweight (optional, ${weightUnit()})`, weightInput]),
    el('label', {}, ['Note', noteInput]),
    err,
    saveBtn
  ]));
}

async function detailView(p, root, container) {
  openModal(el('div', {}, [el('h3', {}, fmtDate(p.taken_on)), skeleton(1, 'block')]));
  const url = await signedUrl(p.storage_path);
  openModal(el('div', {}, [
    el('h3', {}, fmtDate(p.taken_on)),
    url ? el('img', { src: url, alt: '', style: 'width:100%;border-radius:var(--radius-sm);margin-bottom:12px' }) : null,
    p.weight != null ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Bodyweight: ${fmtWeight(p.weight)}`) : null,
    p.note ? el('div', { class: 'muted', style: 'margin-bottom:14px' }, p.note) : null,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn btn-danger', onClick: () => deletePhoto(p, root, container) }, 'Delete'),
      el('button', { class: 'btn btn-primary', onClick: () => shareFlow(p) }, '📤 Share to a friend'),
      el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close')
    ])
  ]));
}

function deletePhoto(p, root, container) {
  confirmModal({
    title: 'Delete photo?', confirmText: 'Delete',
    onConfirm: async () => {
      await sb.storage.from(PRIVATE_BUCKET).remove([p.storage_path]).catch(() => {});
      const { error } = await sb.from('progress_photos').delete().eq('id', p.id);
      if (error) throw error;
      toast('Deleted');
      renderPhotos(container, root);
    }
  });
}

// Copies the ONE selected photo into the public share bucket (never the
// private original/bucket) and sends it as a chat attachment.
async function shareFlow(p) {
  const { accepted, profileById } = await loadFriendships();
  if (!accepted.length) { toast('Add a friend first', ''); return; }
  const uid = getUid();
  formModal({
    title: 'Share to a friend',
    fields: [{
      name: 'friend_id', label: 'Friend', type: 'select',
      options: accepted.map(f => { const oid = otherIdOf(f, uid); return { value: oid, label: '@' + (profileById[oid]?.username || 'unknown') }; })
    }],
    submitText: 'Share',
    onSubmit: async v => {
      const url = await copyToPublicShare(p.storage_path);
      await sendPhotoMessage(v.friend_id, url);
      toast('Shared', 'ok');
    }
  });
}

async function copyToPublicShare(storagePath) {
  const url = await signedUrl(storagePath);
  if (!url) throw new Error('Could not access photo');
  const resp = await fetch(url);
  const blob = await resp.blob();
  const destPath = `${getUid()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await sb.storage.from(SHARE_BUCKET).upload(destPath, blob, { contentType: blob.type || 'image/jpeg' });
  if (up.error) throw up.error;
  const { data } = sb.storage.from(SHARE_BUCKET).getPublicUrl(destPath);
  return data.publicUrl;
}

// ── Before/after compare ─────────────────────────────────────────────────────
function compareView(photos, root) {
  const leftSelect = el('select', {}, photos.map((p, i) => el('option', { value: i, selected: i === photos.length - 1 }, fmtDate(p.taken_on))));
  const rightSelect = el('select', {}, photos.map((p, i) => el('option', { value: i, selected: i === 0 }, fmtDate(p.taken_on))));
  const leftImg = el('img', { style: 'width:100%;border-radius:var(--radius-sm)' });
  const rightImg = el('img', { style: 'width:100%;border-radius:var(--radius-sm)' });

  async function refresh() {
    const l = photos[Number(leftSelect.value)];
    const r = photos[Number(rightSelect.value)];
    signedUrl(l.storage_path).then(u => { if (u) leftImg.src = u; });
    signedUrl(r.storage_path).then(u => { if (u) rightImg.src = u; });
  }
  leftSelect.addEventListener('change', refresh);
  rightSelect.addEventListener('change', refresh);
  refresh();

  openModal(el('div', {}, [
    el('h3', {}, 'Compare'),
    el('div', { class: 'row', style: 'gap:10px' }, [
      el('div', { style: 'flex:1' }, [leftSelect, leftImg]),
      el('div', { style: 'flex:1' }, [rightSelect, rightImg])
    ]),
    el('div', { class: 'modal-actions', style: 'margin-top:14px' }, [
      el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close')
    ])
  ]));
}
