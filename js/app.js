// App bootstrap: config check, session handling, Home launcher + section routing,
// view transitions, and gesture navigation (swipe-back, pull-to-refresh).
import { IS_CONFIGURED } from './config.js';
import { initSession, wireAuthScreen, logout, getUid } from './auth.js';
import { renderResell } from './resell.js';
import { renderFood } from './food.js';
import { renderFitness } from './fitness.js';
import { renderHome } from './home.js';
import { loadAndApplyTheme } from './theme.js';
import { el, toast } from './ui.js';
import { loadOwnProfile, claimUsername } from './profile.js';
import { mountRestTimer } from './resttimer.js';
import { renderFriends } from './social.js';
import { renderAdmin } from './admin.js';

const sections = {
  resell:  { title: 'Reselling', render: renderResell },
  food:    { title: 'Food',      render: renderFood },
  fitness: { title: 'Fitness',   render: renderFitness },
  friends: { title: 'Friends',   render: c => renderFriends(c, c) },
  admin:   { title: 'Admin',     render: c => renderAdmin(c, c) }
};
let activeSection = null; // null = Home launcher; otherwise one of the keys above

function showOnly(id) {
  for (const s of ['setup-notice', 'auth-screen', 'app']) {
    document.getElementById(s).hidden = (s !== id);
  }
  hideSplash();
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) splash.classList.add('hide');
}

function openSection(key) {
  activeSection = key;
  renderActive('forward');
}

function goHome() {
  if (!activeSection) return;
  activeSection = null;
  renderActive('back');
}

function renderActive(direction = 'forward') {
  const backBtn = document.getElementById('back-btn');
  const title = document.getElementById('view-title');
  const container = document.getElementById('view');
  container.innerHTML = '';
  container.classList.remove('view-enter', 'view-enter-back');
  void container.offsetWidth; // force reflow so the animation replays every time
  container.classList.add(direction === 'back' ? 'view-enter-back' : 'view-enter');

  if (!activeSection) {
    backBtn.hidden = true;
    title.textContent = 'Home';
    return Promise.resolve(renderHome(container, openSection)).catch(err => toast(err.message || 'Error', 'err'));
  }

  const s = sections[activeSection];
  backBtn.hidden = false;
  title.textContent = s.title;
  return Promise.resolve(s.render(container)).catch(err => toast(err.message || 'Error', 'err'));
}

function refreshActive() {
  return Promise.resolve(renderActive(activeSection ? 'forward' : 'back'));
}

function wireChrome() {
  document.getElementById('back-btn').onclick = goHome;
  document.getElementById('logout-btn').onclick = async () => {
    try { await logout(); } catch (e) { toast(e.message || 'Could not log out', 'err'); }
  };
}

// Left-edge swipe → back, and pull-down-at-top → refresh. Both are best judged
// on a real phone; this is a best-effort touch implementation for the PWA.
function wireGestures() {
  const pullIndicator = el('div', { class: 'pull-indicator' }, '↓');
  document.body.append(pullIndicator);

  let startX = 0, startY = 0;
  let trackingBack = false, trackingPull = false, pullDist = 0;

  window.addEventListener('touchstart', e => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    trackingBack = !!activeSection && startX < 28;
    trackingPull = window.scrollY <= 0;
    pullDist = 0;
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!trackingPull) return;
    const t = e.touches[0];
    const dy = t.clientY - startY;
    const dx = Math.abs(t.clientX - startX);
    if (dy > 0 && dy > dx && window.scrollY <= 0) {
      pullDist = Math.min(dy, 90);
      pullIndicator.classList.add('show');
      pullIndicator.style.transform = `translateY(${pullDist}px) rotate(${pullDist * 3}deg)`;
    }
  }, { passive: true });

  window.addEventListener('touchend', e => {
    if (trackingBack) {
      const t = e.changedTouches[0];
      const dx = t.clientX - startX, dy = t.clientY - startY;
      if (dx > 70 && Math.abs(dy) < 60) goHome();
    }
    trackingBack = false;

    if (trackingPull && pullDist > 55) {
      pullIndicator.classList.add('loading');
      pullIndicator.style.transform = '';
      refreshActive().finally(() => {
        pullIndicator.classList.remove('show', 'loading');
      });
    } else {
      pullIndicator.classList.remove('show');
      pullIndicator.style.transform = '';
    }
    trackingPull = false; pullDist = 0;
  }, { passive: true });
}

// Username is an app-wide identity (Fitness + Reselling both use it), so it's
// enforced once here rather than per-section. Consumes a username stashed at
// signup (email-confirmation flow) if present; otherwise blocks on a manual
// gate rendered into the view area, before Home ever mounts.
async function ensureUsername() {
  let profile;
  try {
    profile = await loadOwnProfile();
  } catch {
    return; // best-effort — a transient load error shouldn't hard-lock the app
  }
  if (profile) return;

  const pending = localStorage.getItem('pendingUsername');
  if (pending) {
    try {
      await claimUsername(pending);
      localStorage.removeItem('pendingUsername');
      return;
    } catch {
      localStorage.removeItem('pendingUsername'); // stale/taken — fall through to the manual gate
    }
  }
  await usernameGateView();
}

function usernameGateView() {
  return new Promise(resolve => {
    const container = document.getElementById('view');
    document.getElementById('view-title').textContent = 'Welcome';
    container.innerHTML = '';

    const input = el('input', { placeholder: 'e.g. jordan92', style: 'margin-top:0' });
    const err = el('p', { class: 'form-error', hidden: true });
    const btn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:12px' }, 'Continue');
    btn.addEventListener('click', async () => {
      err.hidden = true; btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await claimUsername(input.value);
        resolve();
      } catch (ex) {
        err.textContent = ex.message || 'Failed to save.';
        err.hidden = false; btn.disabled = false; btn.textContent = 'Continue';
      }
    });

    container.append(el('div', { class: 'card', style: 'padding:24px;margin-top:20px' }, [
      el('div', { style: 'font-size:34px;text-align:center;margin-bottom:10px' }, '👋'),
      el('div', { style: 'font-weight:700;font-size:18px;text-align:center;margin-bottom:6px' }, 'Pick a username'),
      el('div', { class: 'muted', style: 'text-align:center;margin-bottom:16px' },
        'Used across the whole app — friends will find you by this. It\'s permanent, so choose carefully.'),
      input, err, btn
    ]));
  });
}

// Checked right after showOnly('app'), before anything else mounts — a
// banned user should never reach Home, the username gate, or any data
// fetch beyond this one profile read. This is a UI convenience layer: the
// real, unbypassable ban enforcement is at the database — the trigger that
// stops a banned user clearing their own `banned` flag (migration-admin.sql)
// and the `is_banned()` RLS guard on write paths (migration-ban-enforcement.sql)
// — this gate exists so the ban actually stops day-to-day app use too.
//
// FAILS CLOSED: a transient read failure retries briefly, then reports
// { ok:false } rather than defaulting to "not banned" — the caller must
// block on anything other than a confirmed banned:false. The earlier
// version returned null (= not banned) on any error, which is exactly the
// fail-open bug that let a banned user back in whenever the profile read
// hung or rejected (most often from inside the auth-callback lock — see
// js/auth.js's deferred onChange dispatch, the actual root-cause fix).
async function checkBanned() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const profile = await loadOwnProfile();
      return { ok: true, banned: !!profile?.banned, profile };
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return { ok: false };
}

function verifyFailedView() {
  const container = document.getElementById('view');
  document.getElementById('view-title').textContent = 'Connection issue';
  document.getElementById('back-btn').hidden = true;
  container.innerHTML = '';
  container.append(el('div', { class: 'card', style: 'padding:24px;margin-top:20px;text-align:center' }, [
    el('div', { style: 'font-size:34px;margin-bottom:10px' }, '⚠️'),
    el('div', { style: 'font-weight:700;font-size:18px;margin-bottom:8px' }, "Couldn't verify your account"),
    el('div', { class: 'muted', style: 'margin-bottom:16px' }, 'Check your connection and try again.'),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:10px', onClick: () => location.reload() }, 'Retry'),
    el('button', {
      class: 'btn btn-ghost btn-block',
      onClick: async () => { try { await logout(); } catch (e) { toast(e.message || 'Could not log out', 'err'); } }
    }, 'Log out')
  ]));
}

function bannedView(reason) {
  const container = document.getElementById('view');
  document.getElementById('view-title').textContent = 'Suspended';
  document.getElementById('back-btn').hidden = true;
  container.innerHTML = '';
  container.append(el('div', { class: 'card', style: 'padding:24px;margin-top:20px;text-align:center' }, [
    el('div', { style: 'font-size:34px;margin-bottom:10px' }, '🚫'),
    el('div', { style: 'font-weight:700;font-size:18px;margin-bottom:8px' }, 'Account suspended'),
    el('div', { class: 'muted', style: 'margin-bottom:16px' }, reason || 'Contact support if you think this is a mistake.'),
    el('button', {
      class: 'btn btn-primary btn-block',
      onClick: async () => { try { await logout(); } catch (e) { toast(e.message || 'Could not log out', 'err'); } }
    }, 'Log out')
  ]));
}

// Guards against a second auth event (e.g. TOKEN_REFRESHED firing while the
// ban check from a prior SIGNED_IN event is still in flight) rendering the
// app over an already-shown ban/verify-failed screen, or vice versa —
// same pattern as js/home.js's homeGen.
let sessionGen = 0;

async function main() {
  if (!IS_CONFIGURED) {
    showOnly('setup-notice');
    return;
  }
  wireAuthScreen();
  wireChrome();
  wireGestures();

  await initSession(async session => {
    const myGen = ++sessionGen;
    if (session) {
      showOnly('app');
      const result = await checkBanned();
      if (myGen !== sessionGen) return; // superseded by a newer session event
      if (!result.ok) { verifyFailedView(); return; }
      if (result.banned) { bannedView(result.profile.ban_reason); return; }
      await ensureUsername();
      if (myGen !== sessionGen) return;
      activeSection = null;
      renderActive('forward');
      loadAndApplyTheme();
      mountRestTimer();
    } else {
      showOnly('auth-screen');
    }
  });

  // Re-check on resume so a user banned mid-session is ejected without
  // needing a refresh. Only acts on a CONFIRMED ban — a transient recheck
  // failure here must not hard-lock an already-working session (unlike the
  // initial gate above, which fails closed because nothing has been shown
  // to trust yet).
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !getUid()) return;
    const myGen = ++sessionGen;
    const result = await checkBanned();
    if (myGen !== sessionGen || !result.ok) return;
    if (result.banned) bannedView(result.profile.ban_reason);
  });
}

main();
