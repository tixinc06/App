// Product catalog: a shared "Community" catalog + each user's private "My products".
// Lets people save sourcing links/images and quickly start a new inventory item from one.
// Community is curated: only admins can publish/edit shared products (also
// enforced in Postgres — see migration-admin.sql's product_catalog policies,
// which are the real guard; the admin checks here just keep the UI honest).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, money, toast, formModal, confirmModal, actionSheet, emptyState, segmented, skeleton, staggerChildren } from './ui.js';
import { isAdmin } from './admin.js';

const BUCKET = 'product-images';
let scope = 'shared'; // 'shared' | 'mine'

async function loadProducts(which) {
  let q = sb.from('product_catalog').select('*').order('created_at', { ascending: false });
  q = which === 'mine' ? q.eq('user_id', getUid()) : q.eq('is_shared', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function renderProducts(root, onAddToInventory) {
  root.innerHTML = '';
  const admin = await isAdmin().catch(() => false);

  root.append(
    segmented(
      [{ value: 'shared', label: 'Community' }, { value: 'mine', label: 'My products' }],
      scope,
      v => { scope = v; renderProducts(root, onAddToInventory); }
    )
  );

  const list = el('div');
  root.append(list);
  list.append(skeleton(4, 'grid'));

  let products;
  try {
    products = await loadProducts(scope);
  } catch (ex) {
    list.innerHTML = '';
    list.append(emptyState('⚠️', 'Could not load products. ' + (ex.message || '')));
    return;
  }
  list.innerHTML = '';

  if (!products.length) {
    list.append(emptyState('🛍️', scope === 'mine'
      ? 'No saved products yet. Tap + to add one.'
      : (admin ? 'No community products yet. Be the first to add one!' : 'No community products yet.')));
  } else {
    const grid = el('div', { class: 'product-grid' });
    for (const p of products) grid.append(productCard(p, root, onAddToInventory, admin));
    staggerChildren(grid);
    list.append(grid);
  }

  // Non-admins can still save PRIVATE products from either tab; they just
  // can't publish to Community — so the add button only hides when they're
  // browsing Community as a non-admin.
  if (scope === 'mine' || admin) {
    root.append(el('button', { class: 'fab', title: 'Add product', onClick: () => addProductForm(root, onAddToInventory, admin) }, '+'));
  }
}

function productCard(p, root, onAddToInventory, admin) {
  const img = p.image_url
    ? el('img', { class: 'p-img', src: p.image_url, alt: '', onError: e => { e.target.replaceWith(el('div', { class: 'p-img' }, '🛍️')); } })
    : el('div', { class: 'p-img' }, '🛍️');
  return el('div', {
    class: 'card product-card',
    onClick: () => productActions(p, root, onAddToInventory, admin)
  }, [
    img,
    el('div', { class: 'p-body' }, [
      el('div', { class: 'p-title' }, p.name),
      el('div', { class: 'p-sub' }, [p.category, p.default_cost != null ? money(p.default_cost) : null].filter(Boolean).join(' · ') || '—'),
      p.product_url ? el('a', { class: 'p-link', href: p.product_url, target: '_blank', rel: 'noopener', onClick: e => e.stopPropagation() }, 'View source ↗') : null
    ])
  ]);
}

function productActions(p, root, onAddToInventory, admin) {
  const mine = p.user_id === getUid();
  const acts = [
    { label: '📦 Add to inventory', primary: true, onClick: () => onAddToInventory(p) }
  ];
  if (mine || admin) {
    acts.push({ label: '✏️ Edit', onClick: () => editProductForm(p, root, onAddToInventory, admin) });
    acts.push({ label: '🗑️ Delete', danger: true, onClick: () => deleteProduct(p, root, onAddToInventory) });
  }
  actionSheet(p.name, acts);
}

// The visibility selector only appears for admins — non-admins can only ever
// save private products (also enforced by the DB CHECK on INSERT/UPDATE).
const productFields = (v = {}, admin = false) => ([
  { name: 'name', label: 'Product name', required: true, value: v.name, placeholder: 'e.g. Wireless earbuds' },
  { name: 'photo', label: 'Upload photo (optional)', type: 'file' },
  { name: 'image_url', label: 'Or image URL (optional)', value: v.image_url, placeholder: 'https://…', help: 'Used only if no photo is uploaded above.' },
  { name: 'product_url', label: 'Source / buy link (optional)', value: v.product_url, placeholder: 'https://…' },
  { name: 'default_cost', label: 'Typical cost', type: 'number', step: '0.01', min: '0', value: v.default_cost },
  { name: 'category', label: 'Category (optional)', value: v.category },
  { name: 'notes', label: 'Notes (optional)', type: 'textarea', value: v.notes },
  ...(admin ? [{
    name: 'is_shared', label: 'Visibility', type: 'select',
    value: v.is_shared === false ? 'no' : 'yes',
    options: [{ value: 'yes', label: 'Shared with community' }, { value: 'no', label: 'Private (just me)' }]
  }] : [])
]);

// Uploads to the public product-images bucket and returns a public URL.
async function uploadProductPhoto(file) {
  const path = `${getUid()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) throw up.error;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function addProductForm(root, onAddToInventory, admin) {
  formModal({
    title: 'Add product',
    fields: productFields({}, admin),
    submitText: 'Save product',
    onSubmit: async v => {
      const { is_shared, photo, image_url, ...rest } = v;
      const finalIsShared = admin && is_shared === 'yes';
      let finalImageUrl = image_url;
      if (photo) {
        try { finalImageUrl = await uploadProductPhoto(photo); }
        catch (ex) { throw new Error('Photo upload failed: ' + (ex.message || 'unknown error')); }
      }
      const { error } = await sb.from('product_catalog')
        .insert({ ...rest, image_url: finalImageUrl, is_shared: finalIsShared, user_id: getUid() });
      if (error) throw error;
      toast('Product saved', 'ok');
      scope = finalIsShared ? 'shared' : 'mine';
      renderProducts(root, onAddToInventory);
    }
  });
}

function editProductForm(p, root, onAddToInventory, admin) {
  // A non-admin who owns an already-shared product (e.g. from before
  // Community became curated) can still edit it — but the save converts it
  // to private, since the DB no longer lets a non-admin's row stay shared.
  // Better to make that explicit and predictable than to let the save fail
  // with an opaque RLS error.
  const willBePrivatized = p.is_shared && !admin;
  formModal({
    title: 'Edit product',
    fields: productFields(p, admin),
    submitText: 'Save',
    onSubmit: async v => {
      const { is_shared, photo, image_url, ...rest } = v;
      let finalImageUrl = image_url;
      if (photo) {
        try { finalImageUrl = await uploadProductPhoto(photo); }
        catch (ex) { throw new Error('Photo upload failed: ' + (ex.message || 'unknown error')); }
      }
      const payload = { ...rest, image_url: finalImageUrl, is_shared: admin ? (is_shared === 'yes') : false };
      const { error } = await sb.from('product_catalog').update(payload).eq('id', p.id);
      if (error) throw error;
      toast(willBePrivatized ? 'Saved — moved to My products (Community is admin-managed)' : 'Saved', 'ok');
      renderProducts(root, onAddToInventory);
    }
  });
}

function deleteProduct(p, root, onAddToInventory) {
  confirmModal({
    title: 'Delete product?',
    message: `"${p.name}" will be removed from the catalog.`,
    confirmText: 'Delete',
    onConfirm: async () => {
      const { error } = await sb.from('product_catalog').delete().eq('id', p.id);
      if (error) throw error;
      toast('Deleted');
      renderProducts(root, onAddToInventory);
    }
  });
}
