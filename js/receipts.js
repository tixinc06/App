// Receipts: a flat, products-style image grid of purchase receipts (image or
// PDF) for the Reselling section — proof of cost basis at tax time. Private
// bucket + signed URLs, same model as js/photos.js and the resell
// item-photo path in js/resell.js. A receipt can optionally link to a
// resell_items row.
//
// A handful of receipts are BUILT IN — shipped as app assets in receipts/,
// hardcoded below, visible to every user (not stored per-account, since
// `receipts` is RLS-scoped to whoever uploaded a row — there is no way for a
// database row to be "everyone's"). They render first, are never uploaded
// anywhere, need no signed URL, and can't be deleted from here.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, money, fmtDate, todayISO, toast, formModal, confirmModal, emptyState,
  skeleton, staggerChildren, openModal, closeModal
} from './ui.js';

const BUCKET = 'receipts';

// Sorted date-descending to match how the flat receipts list already sorts
// (loadReceipts()'s .order('receipt_date', {ascending:false}) below) — the
// five JD ones share one receipt number/timestamp (00267-15-167), which
// only prints a time with no day of month, so they're filed under the
// first Friday of that month.
const BUILTIN_RECEIPTS = [
  { id: 'builtin-miller', name: 'Blue Miller Set', merchant: 'JD Sports', receipt_date: '2026-05-17', amount: 70.98, image: './receipts/blue-miller-set.jpg' },
  { id: 'builtin-coach', name: 'Coach Bag', merchant: 'Flannels', receipt_date: '2026-04-22', amount: 395.00, image: './receipts/coach-bag.jpg' },
  { id: 'builtin-nb9060-jd', name: 'New Balance 9060', merchant: 'JD Sports', receipt_date: '2026-02-06', amount: 170.00, image: './receipts/new-balance-9060-jd.jpg' },
  { id: 'builtin-asics-kayano', name: 'Asics Gel-Kayano 14', merchant: 'JD Sports', receipt_date: '2026-02-06', amount: 165.00, image: './receipts/asics-gel-kayano.jpg' },
  { id: 'builtin-asics-gel', name: 'Asics Gel', merchant: 'JD Sports', receipt_date: '2026-02-06', amount: 155.00, image: './receipts/asics-gel.jpg' },
  { id: 'builtin-shox', name: 'Nike Shox TL', merchant: 'JD Sports', receipt_date: '2026-02-06', amount: 155.00, image: './receipts/nike-shox.jpg' },
  { id: 'builtin-p6000', name: 'Nike P-6000', merchant: 'JD Sports', receipt_date: '2026-02-06', amount: 110.00, image: './receipts/nike-p6000.jpg' },
  { id: 'builtin-nb9060', name: 'New Balance 9060', merchant: 'Foot Locker', receipt_date: '2025-08-11', amount: 160.04, image: './receipts/new-balance-9060-footlocker.jpg' },
  { id: 'builtin-oncloud', name: 'On Cloud X', merchant: 'Foot Locker', receipt_date: '2025-08-11', amount: 140.04, image: './receipts/on-cloud-x.jpg' }
].map(r => ({ ...r, builtin: true }));

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
  if (r.builtin) return true;
  return (r.mime_type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(r.storage_path);
}

export async function renderReceipts(body, root) {
  body.innerHTML = '';
  body.append(skeleton(1, 'block'), skeleton(4, 'grid'));
  let receipts;
  try {
    receipts = await loadReceipts();
  } catch (ex) {
    body.innerHTML = '';
    body.append(emptyState('⚠️', 'Could not load receipts. ' + (ex.message || '')));
    return;
  }
  body.innerHTML = '';

  body.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:18px' }, [
    el('button', { class: 'btn btn-primary', style: 'flex:1', onClick: () => uploadForm(body, root) }, '📄 Add receipt')
  ]));

  const all = [...BUILTIN_RECEIPTS, ...receipts];
  const grid = el('div', { class: 'product-grid' }, all.map(r => receiptCard(r, body, root)));
  body.append(grid);
  staggerChildren(grid);
}

function receiptCard(r, body, root) {
  const img = r.builtin
    ? el('img', { class: 'p-img receipt-img', src: r.image, alt: '' })
    : isImage(r)
      ? (() => { const im = el('img', { class: 'p-img receipt-img', alt: '' }); signedUrl(r.storage_path).then(url => { if (url) im.src = url; }); return im; })()
      : el('div', { class: 'p-img receipt-img' }, '📄');

  const subParts = [r.merchant, r.receipt_date ? fmtDate(r.receipt_date) : null].filter(Boolean);
  return el('div', {
    class: 'card product-card', onClick: () => detailView(r, body, root)
  }, [
    img,
    el('div', { class: 'p-body' }, [
      el('div', { class: 'p-title' }, r.name),
      el('div', { class: 'p-sub' }, subParts.join(' · ') || '—'),
      r.amount != null ? el('div', { class: 'p-sub', style: 'font-weight:700' }, money(r.amount)) : null
    ])
  ]);
}

async function loadItemOptions() {
  const { data, error } = await sb.from('resell_items').select('id,name').order('name');
  if (error) return [];
  return data || [];
}

async function uploadForm(body, root) {
  const items = await loadItemOptions();
  const fileInput = el('input', { type: 'file', accept: 'image/*,application/pdf', required: true });
  const nameInput = el('input', { placeholder: 'e.g. Foot Locker — Crocs', style: 'margin-top:0' });
  const merchantInput = el('input', { placeholder: 'Optional', style: 'margin-top:0' });
  const amountInput = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'Optional', style: 'margin-top:0' });
  const dateInput = el('input', { type: 'date', value: todayISO(), style: 'margin-top:0' });
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
    el('label', {}, ['Link to inventory item', itemSelect]),
    err,
    saveBtn
  ]));
}

// Exported so the file can also be uploaded programmatically via the same
// real code path.
export async function uploadReceipt(file, meta) {
  const uid = getUid();
  const ext = extOf(file.name);
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (up.error) throw up.error;
  const { error } = await sb.from('receipts').insert({
    user_id: uid,
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
  if (r.builtin) {
    openModal(el('div', {}, [
      el('h3', {}, r.name),
      el('img', { src: r.image, alt: '', style: 'width:100%;border-radius:var(--radius-sm);margin-bottom:12px' }),
      r.merchant ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Merchant: ${r.merchant}`) : null,
      r.amount != null ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Amount: ${money(r.amount)}`) : null,
      r.receipt_date ? el('div', { class: 'dim', style: 'margin-bottom:6px' }, `Date: ${fmtDate(r.receipt_date)}`) : null,
      el('div', { class: 'modal-actions' }, [
        // Two built-ins share the name "New Balance 9060" (one Foot Locker,
        // one JD) — the merchant is folded into the download filename so
        // saving both doesn't silently overwrite one with the other.
        // Display elsewhere is untouched, only the saved file is disambiguated.
        el('a', { class: 'btn btn-primary', href: r.image, download: `${r.name} (${r.merchant}).jpg` }, '⬇️ Download'),
        el('a', { class: 'btn btn-ghost', href: r.image, target: '_blank', rel: 'noopener' }, 'Open'),
        el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close')
      ])
    ]));
    return;
  }

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
