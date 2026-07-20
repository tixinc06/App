// App bootstrap: config check, session handling, Home launcher + section routing,
// view transitions, and gesture navigation (swipe-back, pull-to-refresh).
import { IS_CONFIGURED } from './config.js';
import { initSession, wireAuthScreen, logout } from './auth.js';
import { renderResell } from './resell.js';
import { renderFood } from './food.js';
import { renderFitness } from './fitness.js';
import { renderHome } from './home.js';
import { loadAndApplyTheme } from './theme.js';
import { el, toast } from './ui.js';

const sections = {
  resell:  { title: 'Reselling', render: renderResell },
  food:    { title: 'Food',      render: renderFood },
  fitness: { title: 'Fitness',   render: renderFitness }
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

async function main() {
  if (!IS_CONFIGURED) {
    showOnly('setup-notice');
    return;
  }
  wireAuthScreen();
  wireChrome();
  wireGestures();

  await initSession(session => {
    if (session) {
      showOnly('app');
      activeSection = null;
      renderActive('forward');
      loadAndApplyTheme();
    } else {
      showOnly('auth-screen');
    }
  });
}

main();
