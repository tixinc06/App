// Customizable character avatar: composed from layered flat-SVG parts
// (background, skin, hair + colour, face, outfit), matching the slot config
// in js/gamedata.js. Fully deterministic, no external image assets. Config
// lives on profiles.avatar (JSONB) — publicly readable, so it rides on the
// same RLS as usernames and is visible to friends for free.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, toast, closeModal, openModal } from './ui.js';
import { AVATAR_PARTS, DEFAULT_AVATAR } from './gamedata.js';

export async function saveAvatar(config) {
  const { error } = await sb.from('profiles').update({ avatar: config }).eq('user_id', getUid());
  if (error) throw error;
}

function partOf(list, code, fallbackIndex = 0) {
  return list.find(p => p.code === code) || list[fallbackIndex];
}

// ── Part shapes (viewBox 0 0 200 200; head centered at 100,80 r=38) ─────────
function bodyShape(skinColor, outfit) {
  const base = `M35,200 Q35,138 100,132 Q165,138 165,200 Z`;
  if (outfit.code === 'shirtless') return `<path d="${base}" fill="${skinColor}"/>`;
  if (outfit.code === 'stringer') {
    return `
      <path d="${base}" fill="${skinColor}"/>
      <path d="M55,200 Q57,150 82,136 L88,150 Q65,162 63,200 Z" fill="${outfit.color}"/>
      <path d="M145,200 Q143,150 118,136 L112,150 Q135,162 137,200 Z" fill="${outfit.color}"/>
      <path d="M74,200 Q76,168 100,164 Q124,168 126,200 Z" fill="${outfit.color}"/>
    `;
  }
  let extra = '';
  if (outfit.code === 'hoodie') {
    extra = `<path d="M58,150 Q100,122 142,150 L142,168 Q100,142 58,168 Z" fill="${shade(outfit.color, -18)}"/>`;
  } else if (outfit.code === 'tracksuit') {
    extra = `<path d="M60,160 L52,200 L64,200 L70,162 Z" fill="${shade(outfit.color, 30)}"/>
              <path d="M140,160 L148,200 L136,200 L130,162 Z" fill="${shade(outfit.color, 30)}"/>`;
  }
  return `<path d="${base}" fill="${outfit.color}"/>${extra}
    <path d="M80,138 Q100,150 120,138 L120,148 Q100,160 80,148 Z" fill="${shade(outfit.color, -25)}"/>`;
}

function shade(hex, amt) {
  if (!hex || hex.startsWith('var(')) return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function headShape(skinColor) {
  return `<rect x="88" y="95" width="24" height="30" fill="${skinColor}"/>
    <circle cx="100" cy="80" r="38" fill="${skinColor}"/>`;
}

const FACES = {
  focused: `<ellipse cx="86" cy="75" rx="4" ry="5" fill="#2a1a12"/><ellipse cx="114" cy="75" rx="4" ry="5" fill="#2a1a12"/>
    <path d="M80,68 Q86,64 92,67" stroke="#2a1a12" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M108,67 Q114,64 120,68" stroke="#2a1a12" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M90,95 Q100,99 110,95" stroke="#6b4530" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  smile: `<ellipse cx="86" cy="75" rx="4" ry="5" fill="#2a1a12"/><ellipse cx="114" cy="75" rx="4" ry="5" fill="#2a1a12"/>
    <path d="M80,66 Q86,63 92,65" stroke="#2a1a12" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M108,65 Q114,63 120,66" stroke="#2a1a12" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M86,94 Q100,104 114,94" stroke="#6b4530" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  fierce: `<ellipse cx="86" cy="76" rx="4" ry="4" fill="#2a1a12"/><ellipse cx="114" cy="76" rx="4" ry="4" fill="#2a1a12"/>
    <path d="M78,66 L94,72" stroke="#2a1a12" stroke-width="3" stroke-linecap="round"/>
    <path d="M122,66 L106,72" stroke="#2a1a12" stroke-width="3" stroke-linecap="round"/>
    <path d="M88,96 L112,96" stroke="#6b4530" stroke-width="3" stroke-linecap="round"/>
    <rect x="90" y="93" width="20" height="6" rx="1" fill="#fff"/>`,
  cool: `<rect x="76" y="70" width="48" height="14" rx="7" fill="#12121a"/><rect x="76" y="70" width="20" height="14" rx="7" fill="#1a1a26"/>
    <path d="M90,95 Q100,99 110,95" stroke="#6b4530" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  determined: `<ellipse cx="86" cy="76" rx="4" ry="4.5" fill="#2a1a12"/><ellipse cx="114" cy="76" rx="4" ry="4.5" fill="#2a1a12"/>
    <path d="M79,68 L93,71" stroke="#2a1a12" stroke-width="3" stroke-linecap="round"/>
    <path d="M121,68 L107,71" stroke="#2a1a12" stroke-width="3" stroke-linecap="round"/>
    <path d="M92,96 L108,96" stroke="#6b4530" stroke-width="2.5" stroke-linecap="round"/>`
};

const HAIR = {
  bald: () => '',
  short: c => `<path d="M62,72 Q60,38 100,36 Q140,38 138,72 Q136,50 100,48 Q64,50 62,72 Z" fill="${c}"/>`,
  buzz: c => `<path d="M64,68 Q64,42 100,40 Q136,42 136,68 Q134,55 100,53 Q66,55 64,68 Z" fill="${c}" opacity="0.9"/>`,
  messy: c => `<path d="M58,70 Q54,32 100,30 Q146,32 142,70 Q140,44 122,40 Q126,50 112,42 Q110,52 98,42 Q92,54 82,42 Q80,52 66,44 Q62,52 58,70 Z" fill="${c}"/>`,
  long: c => `<path d="M60,72 Q56,36 100,34 Q144,36 140,72 L144,130 Q136,120 132,90 Q128,60 100,56 Q72,60 68,90 Q64,120 56,130 Z" fill="${c}"/>`,
  quiff: c => `<path d="M64,70 Q62,50 80,42 Q88,20 108,28 Q126,24 136,44 Q140,54 136,68 Q132,48 100,50 Q66,52 64,70 Z" fill="${c}"/>`,
  ponytail: c => `<path d="M62,72 Q60,38 100,36 Q140,38 138,72 Q136,50 100,48 Q64,50 62,72 Z" fill="${c}"/><path d="M136,58 Q156,64 152,100 Q148,90 140,80 Z" fill="${c}"/>`,
  curly: c => `<circle cx="68" cy="55" r="14" fill="${c}"/><circle cx="86" cy="42" r="15" fill="${c}"/><circle cx="108" cy="40" r="15" fill="${c}"/><circle cx="128" cy="50" r="14" fill="${c}"/><circle cx="136" cy="66" r="12" fill="${c}"/>`
};

let gradCounter = 0;

// Renders a fully self-contained circular avatar (background + character) as
// a detached SVG element ready to append anywhere — friends list rows, the
// leaderboard, the profile hero, the customizer preview, etc. `config` may be
// null/partial (new users) — missing slots fall back to DEFAULT_AVATAR.
export function renderAvatarSVG(config, opts = {}) {
  const cfg = { ...DEFAULT_AVATAR, ...(config || {}) };
  const size = opts.size || 96;
  const gid = 'av' + (gradCounter++);

  const bg = partOf(AVATAR_PARTS.backgrounds, cfg.bg);
  const skin = partOf(AVATAR_PARTS.skins, cfg.skin);
  const hairColor = partOf(AVATAR_PARTS.hairColors, cfg.hairColor);
  const outfit = partOf(AVATAR_PARTS.outfits, cfg.outfit);
  const face = FACES[cfg.face] || FACES.focused;
  const hairFn = HAIR[cfg.hair] || HAIR.short;

  const svgMarkup = `
    <svg viewBox="0 0 200 200" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="avatar-svg">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg.colors[0]}"/>
          <stop offset="100%" stop-color="${bg.colors[1]}"/>
        </linearGradient>
        <clipPath id="${gid}c"><circle cx="100" cy="100" r="100"/></clipPath>
      </defs>
      <g clip-path="url(#${gid}c)">
        <rect width="200" height="200" fill="url(#${gid})"/>
        ${bodyShape(skin.color, outfit)}
        ${headShape(skin.color)}
        ${face}
        ${hairFn(hairColor.color)}
      </g>
    </svg>`.trim();

  const wrapper = document.createElement('div');
  wrapper.innerHTML = svgMarkup;
  return wrapper.firstElementChild;
}

// A modal with a live preview + chip-row pickers for each slot. `onSaved`
// (optional) is called with the new config after a successful save, so the
// caller can re-render without this module needing to know about the page.
export function avatarCustomizer(currentConfig, onSaved) {
  const cfg = { ...DEFAULT_AVATAR, ...(currentConfig || {}) };
  const previewWrap = el('div', { style: 'display:flex;justify-content:center;margin-bottom:18px' });

  function refreshPreview() {
    previewWrap.innerHTML = '';
    previewWrap.append(renderAvatarSVG(cfg, { size: 140 }));
  }
  refreshPreview();

  function slotRow(label, options, key) {
    const chipsWrap = el('div', { class: 'ex-chip-row' });
    function renderChips() {
      chipsWrap.innerHTML = '';
      chipsWrap.append(...options.map(o => el('button', {
        type: 'button', class: 'ex-chip' + (cfg[key] === o.code ? ' active' : ''),
        onClick: () => { cfg[key] = o.code; refreshPreview(); renderChips(); }
      }, o.name)));
    }
    renderChips();
    return el('div', { style: 'margin-bottom:14px' }, [
      el('div', { class: 'k', style: 'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:6px' }, label),
      chipsWrap
    ]);
  }

  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, 'Save avatar');
  saveBtn.addEventListener('click', async () => {
    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      await saveAvatar(cfg);
      closeModal();
      toast('Avatar saved', 'ok');
      onSaved?.(cfg);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Save avatar';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, 'Customize avatar'),
    previewWrap,
    slotRow('Background', AVATAR_PARTS.backgrounds, 'bg'),
    slotRow('Skin tone', AVATAR_PARTS.skins, 'skin'),
    slotRow('Hair', AVATAR_PARTS.hair, 'hair'),
    slotRow('Hair colour', AVATAR_PARTS.hairColors, 'hairColor'),
    slotRow('Face', AVATAR_PARTS.faces, 'face'),
    slotRow('Outfit', AVATAR_PARTS.outfits, 'outfit'),
    err,
    saveBtn
  ]));
}
