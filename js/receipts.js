// Receipts vault: folders of purchase receipts (image or PDF) for the
// Reselling section — proof of cost basis at tax time. Private bucket +
// signed URLs, same model as js/photos.js and the resell item-photo path
// in js/resell.js. A receipt can optionally link to a resell_items row.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, money, fmtDate, todayISO, toast, formModal, confirmModal, actionSheet, emptyState,
  skeleton, staggerChildren, openModal, closeModal
} from './ui.js';

const BUCKET = 'receipts';

// null = folder grid; a folder id, or the string 'unfiled', = that folder's
// contents. Module-level so it survives a re-render, same idiom resell.js
// uses for `segment`.
let openFolderId = null;

async function loadFolders() {
  const { data, error } = await sb.from('receipt_folders').select('*').order('created_at');
  if (error) throw error;
  return data || [];
}

async function loadReceipts() {
  const { data, error } = await sb.from('receipts').select('*').order('receipt_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function signedUrl(path, filename) {
  const opts = filename ? { download: filename } : undefined;
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600, opts);
  return data?.signedUrl || null;
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : 'jpg';
}

function isImage(r) {
  return (r.mime_type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(r.storage_path);
}

export async function renderReceipts(body, root) {
  body.innerHTML = '';
  body.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let folders, receipts;
  try {
    [folders, receipts] = await Promise.all([loadFolders(), loadReceipts()]);
  } catch (ex) {
    body.innerHTML = '';
    body.append(emptyState('⚠️', 'Could not load receipts. ' + (ex.message || '')));
    return;
  }
  body.innerHTML = '';

  if (openFolderId != null) renderFolderContents(body, root, folders, receipts);
  else renderFolderGrid(body, root, folders, receipts);
}

function renderFolderGrid(body, root, folders, receipts) {
  body.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:18px' }, [
    el('button', { class: 'btn btn-primary', style: 'flex:1', onClick: () => newFolderForm(body, root) }, '📁 New folder')
  ]));

  const rows = [];
  for (const f of folders) {
    const inFolder = receipts.filter(r => r.folder_id === f.id);
    const total = inFolder.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    rows.push(folderRow('📁', f.name, inFolder.length, total, () => { openFolderId = f.id; renderReceipts(body, root); }, () => folderActions(f, body, root)));
  }
  const unfiled = receipts.filter(r => !r.folder_id);
  const unfiledTotal = unfiled.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  rows.push(folderRow('🗂️', 'Unfiled', unfiled.length, unfiledTotal, () => { openFolderId = 'unfiled'; renderReceipts(body, root); }, null));

  const list = el('div', { class: 'list' }, rows);
  body.append(list);
  staggerChildren(list);
}

function folderRow(icon, name, count, total, onClick, onLongPress) {
  return el('div', { class: 'card item', onClick }, [
    el('div', { class: 'thumb' }, icon),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, name),
      el('div', { class: 'sub' }, `${count} receipt${count === 1 ? '' : 's'} · ${money(total)}`)
    ]),
    onLongPress ? el('button', {
      class: 'btn btn-sm btn-ghost', onClick: e => { e.stopPropagation(); onLongPress(); }
    }, '⋯') : el('div', { class: 'home-arrow' }, '›')
  ]);
}

function folderActions(folder, body, root) {
  actionSheet(folder.name, [
    { label: '✏️ Rename', onClick: () => renameFolderForm(folder, body, root) },
    {
      label: '🗑️ Delete folder', danger: true, onClick: () => confirmModal({
        title: 'Delete folder?',
        message: 'Receipts inside move to Unfiled — nothing is deleted.',
        confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('receipt_folders').delete().eq('id', folder.id);
          if (error) throw error;
          toast('Folder deleted', 'ok');
          renderReceipts(body, root);
        }
      })
    }
  ]);
}

function newFolderForm(body, root) {
  formModal({
    title: 'New folder',
    fields: [{ name: 'name', label: 'Name', required: true }],
    submitText: 'Create',
    onSubmit: async v => {
      const { error } = await sb.from('receipt_folders').insert({ user_id: getUid(), name: v.name });
      if (error) throw error;
      toast('Folder created', 'ok');
      renderReceipts(body, root);
    }
  });
}

function renameFolderForm(folder, body, root) {
  formModal({
    title: 'Rename folder',
    fields: [{ name: 'name', label: 'Name', value: folder.name, required: true }],
    submitText: 'Save',
    onSubmit: async v => {
      const { error } = await sb.from('receipt_folders').update({ name: v.name }).eq('id', folder.id);
      if (error) throw error;
      toast('Renamed', 'ok');
      renderReceipts(body, root);
    }
  });
}

function renderFolderContents(body, root, folders, receipts) {
  const folder = openFolderId === 'unfiled' ? null : folders.find(f => f.id === openFolderId);
  const inFolder = openFolderId === 'unfiled'
    ? receipts.filter(r => !r.folder_id)
    : receipts.filter(r => r.folder_id === openFolderId);

  body.append(el('div', {
    class: 'dim', style: 'font-size:13px;font-weight:600;margin-bottom:12px;cursor:pointer',
    onClick: () => { openFolderId = null; renderReceipts(body, root); }
  }, '‹ All folders'));

  body.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:18px' }, [
    el('button', {
      class: 'btn btn-primary', style: 'flex:1',
      onClick: () => uploadForm(folders, folder, body, root)
    }, '📄 Add receipt')
  ]));

  if (!inFolder.length) {
    body.append(emptyState('🧾', 'No receipts here yet.'));
    return;
  }

  const list = el('div', { class: 'list' }, inFolder.map(r => receiptRow(r, body, root)));
  body.append(list);
  staggerChildren(list);
}

function receiptRow(r, body, root) {
  let thumb;
  if (isImage(r)) {
    thumb = el('img', { class: 'thumb', alt: '' });
    signedUrl(r.storage_path).then(url => { if (url) thumb.src = url; });
  } else {
    thumb = el('div', { class: 'thumb' }, '📄');
  }
  const subParts = [r.merchant, r.receipt_date ? fmtDate(r.receipt_date) : null].filter(Boolean);
  return el('div', { class: 'card item', onClick: () => detailView(r, body, root) }, [
    thumb,
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, r.name),
      el('div', { class: 'sub' }, subParts.join(' · ') || '—')
    ]),
    r.amount != null ? el('div', { class: 'amt' }, money(r.amount)) : null
  ]);
}

async function loadItemOptions() {
  const { data, error } = await sb.from('resell_items').select('id,name').order('name');
  if (error) return [];
  return data || [];
}

async function uploadForm(folders, folder, body, root) {
  const items = await loadItemOptions();
  const fileInput = el('input', { type: 'file', accept: 'image/*,application/pdf', required: true });
  const nameInput = el('input', { placeholder: 'e.g. Foot Locker — Crocs', style: 'margin-top:0' });
  const merchantInput = el('input', { placeholder: 'Optional', style: 'margin-top:0' });
  const amountInput = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'Optional', style: 'margin-top:0' });
  const dateInput = el('input', { type: 'date', value: todayISO(), style: 'margin-top:0' });
  const folderSelect = el('select', {}, [
    el('option', { value: '' }, 'Unfiled'),
    ...folders.map(f => el('option', { value: f.id }, f.name))
  ]);
  // Setting .value directly (rather than an option's `selected` attribute)
  // is what reliably drives a <select>'s initial pick.
  if (folder) folderSelect.value = folder.id;
  const itemSelect = el('select', {}, [
    el('option', { value: '' }, '— None —'),
    ...items.map(i => el('option', { value: i.id }, i.name))
  ]);
  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, 'Save receipt');

  saveBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) { err.textContent = 'Choose a file.'; err.hidden = false; return; }
    if (!nameInput.value.trim()) { err.textContent = 'Give it a name.'; err.hidden = false; return; }
    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Uploading…';
    try {
      await uploadReceipt(file, {
        name: nameInput.value.trim(),
        merchant: merchantInput.value.trim(),
        amount: amountInput.value === '' ? null : Number(amountInput.value),
        receipt_date: dateInput.value || null,
        folder_id: folderSelect.value || null,
        item_id: itemSelect.value || null
      });
      closeModal();
      toast('Receipt saved', 'ok');
      renderReceipts(body, root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Save receipt';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, 'Add receipt'),
    el('label', {}, ['File (image or PDF)', fileInput]),
    el('label', {}, ['Name', nameInput]),
    el('label', {}, ['Merchant', merchantInput]),
    el('label', {}, ['Amount', amountInput]),
    el('label', {}, ['Date', dateInput]),
    el('label', {}, ['Folder', folderSelect]),
    el('label', {}, ['Link to inventory item', itemSelect]),
    err,
    saveBtn
  ]));
}

// Exported so the file can also be uploaded programmatically (e.g. seeding a
// receipt from outside the form UI) via the same real code path.
export async function uploadReceipt(file, meta) {
  const uid = getUid();
  const ext = extOf(file.name);
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (up.error) throw up.error;
  const { error } = await sb.from('receipts').insert({
    user_id: uid,
    folder_id: meta.folder_id,
    item_id: meta.item_id,
    name: meta.name,
    merchant: meta.merchant || '',
    amount: meta.amount,
    receipt_date: meta.receipt_date,
    storage_path: path,
    mime_type: file.type || '',
    size_bytes: file.size || null
  });
  if (error) throw error;
}

async function detailView(r, body, root) {
  openModal(el('div', {}, [el('h3', {}, r.name), skeleton(1, 'block')]));
  const url = await signedUrl(r.storage_path);
  const downloadUrl = await signedUrl(r.storage_path, `${r.name}.${extOf(r.storage_path)}`);

  const item = r.item_id ? (await sb.from('resell_items').select('name').eq('id', r.item_id).maybeSingle()).data : null;

  openModal(el('div', {}, [
    el('h3', {}, r.name),
    isImage(r) && url ? el('img', { src: url, alt: '', style: 'width:100%;border-radius:var(--radius-sm);margin-bottom:12px' }) : null,
    !isImage(r) ? el('div', { class: 'dim', style: 'margin-bottom:12px' }, '📄 PDF document') : null,
    r.merchant ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Merchant: ${r.merchant}`) : null,
    r.amount != null ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Amount: ${money(r.amount)}`) : null,
    r.receipt_date ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Date: ${fmtDate(r.receipt_date)}`) : null,
    item ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Linked item: ${item.name}`) : null,
    el('div', { class: 'modal-actions' }, [
      downloadUrl ? el('a', { class: 'btn btn-primary', href: downloadUrl }, '⬇️ Download') : null,
      url ? el('a', { class: 'btn btn-ghost', href: url, target: '_blank', rel: 'noopener' }, 'Open') : null,
      el('button', { class: 'btn btn-danger', onClick: () => deleteReceipt(r, body, root) }, 'Delete'),
      el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close')
    ])
  ]));
}

function deleteReceipt(r, body, root) {
  confirmModal({
    title: 'Delete receipt?', confirmText: 'Delete',
    onConfirm: async () => {
      await sb.storage.from(BUCKET).remove([r.storage_path]).catch(() => {});
      const { error } = await sb.from('receipts').delete().eq('id', r.id);
      if (error) throw error;
      toast('Deleted');
      renderReceipts(body, root);
    }
  });
}
