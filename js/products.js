// Product catalog: a shared "Community" catalog + each user's private "My products".
// Lets people save sourcing links/images and quickly start a new inventory item from one.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, money, toast, formModal, confirmModal, actionSheet, emptyState, segmented } from './ui.js';

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
  root.append(
    segmented(
      [{ value: 'shared', label: 'Community' }, { value: 'mine', label: 'My products' }],
      scope,
      v => { scope = v; renderProducts(root, onAddToInventory); }
    )
  );

  const list = el('div');
  root.append(list);
  list.append(el('p', { class: 'muted' }, 'Loading…'));

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
      : 'No community products yet. Be the first to add one!'));
  } else {
    const grid = el('div', { class: 'product-grid' });
    for (const p of products) grid.append(productCard(p, root, onAddToInventory));
    list.append(grid);
  }

  root.append(el('button', { class: 'fab', title: 'Add product', onClick: () => addProductForm(root, onAddToInventory) }, '+'));
}

function productCard(p, root, onAddToInventory) {
  const img = p.image_url
    ? el('img', { class: 'p-img', src: p.image_url, alt: '', onError: e => { e.target.replaceWith(el('div', { class: 'p-img' }, '🛍️')); } })
    : el('div', { class: 'p-img' }, '🛍️');
  return el('div', {
    class: 'card product-card',
    onClick: () => productActions(p, root, onAddToInventory)
  }, [
    img,
    el('div', { class: 'p-body' }, [
      el('div', { class: 'p-title' }, p.name),
      el('div', { class: 'p-sub' }, [p.category, p.default_cost != null ? money(p.default_cost) : null].filter(Boolean).join(' · ') || '—'),
      p.product_url ? el('a', { class: 'p-link', href: p.product_url, target: '_blank', rel: 'noopener', onClick: e => e.stopPropagation() }, 'View source ↗') : null
    ])
  ]);
}

function productActions(p, root, onAddToInventory) {
  const mine = p.user_id === getUid();
  const acts = [
    { label: '📦 Add to inventory', primary: true, onClick: () => onAddToInventory(p) }
  ];
  if (mine) {
    acts.push({ label: '✏️ Edit', onClick: () => editProductForm(p, root, onAddToInventory) });
    acts.push({ label: '🗑️ Delete', danger: true, onClick: () => deleteProduct(p, root, onAddToInventory) });
  }
  actionSheet(p.name, acts);
}

const productFields = (v = {}) => ([
  { name: 'name', label: 'Product name', required: true, value: v.name, placeholder: 'e.g. Wireless earbuds' },
  { name: 'image_url', label: 'Image URL (optional)', value: v.image_url, placeholder: 'https://…' },
  { name: 'product_url', label: 'Source / buy link (optional)', value: v.product_url, placeholder: 'https://…' },
  { name: 'default_cost', label: 'Typical cost', type: 'number', step: '0.01', min: '0', value: v.default_cost },
  { name: 'category', label: 'Category (optional)', value: v.category },
  { name: 'notes', label: 'Notes (optional)', type: 'textarea', value: v.notes },
  {
    name: 'is_shared', label: 'Visibility', type: 'select',
    value: v.is_shared === false ? 'no' : 'yes',
    options: [{ value: 'yes', label: 'Shared with community' }, { value: 'no', label: 'Private (just me)' }]
  }
]);

function addProductForm(root, onAddToInventory) {
  formModal({
    title: 'Add product',
    fields: productFields(),
    submitText: 'Save product',
    onSubmit: async v => {
      const { is_shared, ...rest } = v;
      const { error } = await sb.from('product_catalog')
        .insert({ ...rest, is_shared: is_shared === 'yes', user_id: getUid() });
      if (error) throw error;
      toast('Product saved', 'ok');
      scope = is_shared === 'yes' ? 'shared' : 'mine';
      renderProducts(root, onAddToInventory);
    }
  });
}

function editProductForm(p, root, onAddToInventory) {
  formModal({
    title: 'Edit product',
    fields: productFields(p),
    submitText: 'Save',
    onSubmit: async v => {
      const { is_shared, ...rest } = v;
      const { error } = await sb.from('product_catalog')
        .update({ ...rest, is_shared: is_shared === 'yes' }).eq('id', p.id);
      if (error) throw error;
      toast('Saved', 'ok');
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
