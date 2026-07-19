// App bootstrap: config check, session handling, tab routing, view mounting.
import { IS_CONFIGURED } from './config.js';
import { initSession, wireAuthScreen, logout } from './auth.js';
import { renderResell } from './resell.js';
import { renderFood } from './food.js';
import { renderFitness } from './fitness.js';
import { toast } from './ui.js';

const views = {
  resell:  { title: 'Reselling', render: renderResell },
  food:    { title: 'Food',      render: renderFood },
  fitness: { title: 'Fitness',   render: renderFitness }
};
let activeTab = 'resell';

function showOnly(id) {
  for (const s of ['setup-notice', 'auth-screen', 'app']) {
    document.getElementById(s).hidden = (s !== id);
  }
}

function renderActive() {
  const v = views[activeTab];
  document.getElementById('view-title').textContent = v.title;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
  const container = document.getElementById('view');
  container.innerHTML = '';
  Promise.resolve(v.render(container)).catch(err => toast(err.message || 'Error', 'err'));
}

function wireChrome() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      if (activeTab === tab.dataset.tab) return;
      activeTab = tab.dataset.tab;
      renderActive();
    };
  });
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
      renderActive();
    } else {
      showOnly('auth-screen');
    }
  });
}

main();
