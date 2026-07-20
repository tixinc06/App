// App bootstrap: config check, session handling, Home launcher + section routing.
import { IS_CONFIGURED } from './config.js';
import { initSession, wireAuthScreen, logout } from './auth.js';
import { renderResell } from './resell.js';
import { renderFood } from './food.js';
import { renderFitness } from './fitness.js';
import { renderHome } from './home.js';
import { toast } from './ui.js';

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
}

function openSection(key) {
  activeSection = key;
  renderActive();
}

function goHome() {
  activeSection = null;
  renderActive();
}

function renderActive() {
  const backBtn = document.getElementById('back-btn');
  const title = document.getElementById('view-title');
  const container = document.getElementById('view');
  container.innerHTML = '';

  if (!activeSection) {
    backBtn.hidden = true;
    title.textContent = 'Home';
    Promise.resolve(renderHome(container, openSection)).catch(err => toast(err.message || 'Error', 'err'));
    return;
  }

  const s = sections[activeSection];
  backBtn.hidden = false;
  title.textContent = s.title;
  Promise.resolve(s.render(container)).catch(err => toast(err.message || 'Error', 'err'));
}

function wireChrome() {
  document.getElementById('back-btn').onclick = goHome;
  document.getElementById('logout-btn').onclick = async () => {
    try { await logout(); } catch (e) { toast(e.message || 'Could not log out', 'err'); }
  };
}

async function main() {
  if (!IS_CONFIGURED) {
    showOnly('setup-notice');
    return;
  }
  wireAuthScreen();
  wireChrome();

  await initSession(session => {
    if (session) {
      showOnly('app');
      activeSection = null;
      renderActive();
    } else {
      showOnly('auth-screen');
    }
  });
}

main();
