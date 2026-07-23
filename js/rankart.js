// Rank art swap-in point: maps a GROUP name to its emblem image + tier
// colour, and renders a "rank tile" (rounded-square frame + colour ring,
// optional division-pip row). This is the ONLY place that knows about actual
// image files — everything else in the Ranks UI works with group names.
//
// Champion/Grand Champion/Godly art is pending (the user is producing it
// separately — pink, red, and something fully unique for Godly). Until each
// file lands, that group renders a neutral placeholder tile instead of a
// broken image. Swapping one in later is a one-line path change below.
import { el } from './ui.js';
import { GROUPS, DIVISIONS_PER_GROUP } from './standards.js';

const RANK_ART = {
  'Bronze':         { src: 'ranks/bronze.jpg',   color: '#cd7f32' },
  'Silver':         { src: 'ranks/silver.jpg',   color: '#c0c0d0' },
  'Gold':           { src: 'ranks/gold.jpg',     color: '#ffc83c' },
  'Platinum':       { src: 'ranks/platinum.jpg', color: '#8cdcd2' },
  'Diamond':        { src: 'ranks/diamond.jpg',  color: '#5ac8ff' },
  'Champion':       { src: null, color: '#ff5ec4' },  // pink — art pending
  'Grand Champion': { src: null, color: '#ff3b3b' },  // red — art pending
  'Godly':          { src: null, color: '#ffd700' }   // art pending; gets the animated frame regardless
};

export const DIVISIONS_BY_GROUP = Object.fromEntries(GROUPS.map((g, i) => [g, DIVISIONS_PER_GROUP[i]]));

export function groupColor(group) {
  return (RANK_ART[group] || {}).color || 'var(--muted)';
}

export function hasArt(group) {
  return !!RANK_ART[group]?.src;
}

// A row of dots showing which division (1-based) within a group is lit,
// e.g. division=3, of=5 -> ●●●○○.
export function pipRow(division, of, color) {
  const dots = [];
  for (let i = 1; i <= of; i++) {
    dots.push(el('span', {
      class: 'rank-pip' + (i <= division ? ' lit' : ''),
      style: i <= division ? `background:${color}` : ''
    }));
  }
  return el('div', { class: 'rank-pip-row' }, dots);
}

// Builds a rank emblem tile: image (or a neutral placeholder while art is
// pending) inside a rounded-square frame with a tier-coloured ring. `size`
// in px. `locked` dims it (used in the full ladder for groups not yet
// reached). Godly always gets the animated glow frame, even pre-art.
export function rankTile(group, { size = 72, locked = false } = {}) {
  const art = RANK_ART[group] || { src: null, color: 'var(--muted)' };
  const isGodly = group === 'Godly';

  const inner = art.src
    ? el('img', { src: art.src, alt: group, class: 'rank-tile-img' })
    : el('div', { class: 'rank-tile-placeholder' }, isGodly ? '👑' : '🛡️');

  return el('div', {
    class: 'rank-tile' + (isGodly ? ' rank-tile-godly' : '') + (locked ? ' rank-tile-locked' : ''),
    style: `width:${size}px;height:${size}px;--rank-color:${art.color}`
  }, isGodly ? [el('div', { class: 'rank-tile-godly-ring' }), inner] : [inner]);
}
