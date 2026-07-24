// Fitness "Profile" hub (eg4-style): a compact status row (level/XP, streak,
// Plates), a hero banner with a customizable avatar + username + prestige
// title + rank emblem, an Add Friends CTA, a shortcut grid, a "Memories"
// week-at-a-glance calendar, then the existing weekly quests / goals /
// personal records / achievements sections. Keeps the old filename/export
// name (renderProgress) since js/fitness.js already wires it in — only the
// content changed, not the integration point.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, toast, formModal, confirmModal, actionSheet, emptyState,
  skeleton, staggerChildren, countUp, celebrate, todayISO, isoOf
} from './ui.js';
import { loadProgress, xpToNext, maxLevelForTrack, prestige } from './progression.js';
import { MAX_PRESTIGE, SHOP_ITEMS, PRESTIGE_TITLES, MASTER_TITLE, weekendEventMsLeft } from './gamedata.js';
import { computeStreak } from './streaks.js';
import { loadStats, loadAchievementsView } from './achievements.js';
import { loadQuestProgress, claimQuest } from './quests.js';
import { loadOwnProfile } from './profile.js';
import { loadOverallRank, rankBadge } from './ranks.js';
import { renderAvatar, avatarCustomizer } from './avatar.js';
import { isMuted, toggleMuted } from './sound.js';
import { goToSegment } from './fitness.js';
import { loadShopState, equipTheme, equipBanner, activateOwnedBooster } from './shop.js';
import { renderWeightPlanner } from './tdee.js';
import { isPushSupported, getPushState, enablePush, disablePush, loadNotifPrefs, saveNotifPrefs, NOTIF_TYPES } from './push.js';
import { renderMeasurements } from './measurements.js';
import { renderPhotos } from './photos.js';
import { plateCalculatorModal } from './platecalc.js';
import { renderWorkoutCalendar } from './workoutcal.js';
import { weightUnit, kgToDisplay, displayToKg, fmtWeight, weightStep } from './units.js';

async function loadExtras() {
  const uid = getUid();
  const [prs, goals] = await Promise.all([
    sb.from('personal_records').select('*').eq('user_id', uid).order('best_e1rm', { ascending: false }),
    sb.from('fitness_goals').select('*').eq('user_id', uid).order('created_at', { ascending: false })
  ]);
  if (prs.error) throw prs.error;
  if (goals.error) throw goals.error;
  return { prs: prs.data || [], goals: goals.data || [] };
}

// Best-effort: the equipped banner's gradient, or null if none/unavailable.
async function loadBannerGradient() {
  try {
    const { data } = await sb.from('user_settings').select('equipped_banner').eq('user_id', getUid()).maybeSingle();
    if (!data?.equipped_banner) return null;
    return SHOP_ITEMS.banners.find(b => b.code === data.equipped_banner)?.gradient || null;
  } catch {
    return null;
  }
}

async function loadOwnWorkoutDates() {
  const { data, error } = await sb.from('workouts').select('workout_date').eq('user_id', getUid());
  if (error) throw error;
  return data || [];
}

// Drill-in state: which sub-view the Profile tab is showing. 'hub' is the
// compact landing screen; the rest are full-screen sections reached from the
// shortcut grid, each with their own back control.
let profileView = 'hub';

export function resetProfileView() {
  profileView = 'hub';
}

function goProfileView(view, container, root) {
  profileView = view;
  renderProgress(container, root);
}

function backHeader(title, container, root) {
  return el('div', { class: 'section-head profile-subview-head' }, [
    el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => goProfileView('hub', container, root) }, '‹ Back'),
    el('h2', {}, title)
  ]);
}

export async function renderProgress(container, root) {
  if (profileView !== 'hub') return renderSubView(container, root);

  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let progress, bannerGradient, streak, profile, overallRank, workouts;
  try {
    progress = await loadProgress();
    bannerGradient = await loadBannerGradient();
    workouts = await loadOwnWorkoutDates();
    streak = await computeStreak(workouts);
    profile = await loadOwnProfile();
    overallRank = await loadOverallRank().catch(() => null);
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load progress. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  const eventBanner = weekendEventBanner();
  if (eventBanner) container.append(eventBanner);
  container.append(statusHeader(progress, streak));
  container.append(heroBanner(profile, progress, bannerGradient, overallRank, container, root));
  container.append(el('button', {
    class: 'btn btn-primary btn-block', style: 'margin-bottom:18px',
    onClick: () => goToSegment('friends', root)
  }, '👥 Add Friends'));
  container.append(shortcutGrid(profile, container, root));
  container.append(memoriesCard(workouts));
}

async function renderSubView(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(4, 'item'));
  try {
    if (profileView === 'quests') await renderQuestsView(container, root);
    else if (profileView === 'goals') await renderGoalsView(container, root);
    else if (profileView === 'prs') await renderPRsView(container, root);
    else if (profileView === 'achievements') await renderAchievementsSubView(container, root);
    else if (profileView === 'inventory') await renderInventoryView(container, root);
    else if (profileView === 'weight-planner') await renderWeightPlannerSubView(container, root);
    else if (profileView === 'alerts') await renderAlertsView(container, root);
    else if (profileView === 'measurements') await renderMeasurementsView(container, root);
    else if (profileView === 'photos') await renderPhotosView(container, root);
    else if (profileView === 'history') await renderHistoryView(container, root);
    else { profileView = 'hub'; return renderProgress(container, root); }
  } catch (ex) {
    container.innerHTML = '';
    container.append(backHeader('Error', container, root));
    container.append(emptyState('⚠️', 'Could not load. ' + (ex.message || '')));
  }
}

async function renderQuestsView(container, root) {
  const progress = await loadProgress();
  const extras = await loadExtras();
  const workouts = await loadOwnWorkoutDates();
  const questsView = await loadQuestProgress(workouts, extras.prs, extras.goals);
  const onCooldown = !!(progress.xp_cooldown_until && new Date(progress.xp_cooldown_until) > new Date());

  container.innerHTML = '';
  container.append(backHeader('Weekly quests', container, root));
  const questList = el('div', { class: 'list' }, questsView.quests.map(q => questRow(q, questsView.weekStart, onCooldown, container, root)));
  staggerChildren(questList);
  container.append(questList);
}

async function renderGoalsView(container, root) {
  const { prs, goals } = await loadExtras();
  const openGoals = goals.filter(g => !g.achieved);
  const achievedGoals = goals.filter(g => g.achieved);

  container.innerHTML = '';
  container.append(el('div', { class: 'section-head profile-subview-head' }, [
    el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => goProfileView('hub', container, root) }, '‹ Back'),
    el('h2', {}, 'Goals'),
    el('button', { class: 'link', onClick: () => addGoalForm(container, root) }, '＋ Add goal')
  ]));
  if (!goals.length) {
    container.append(emptyState('🎯', 'No goals yet. Set one, e.g. "100kg bench".'));
  } else {
    if (openGoals.length) {
      const list = el('div', { class: 'list', style: 'margin-bottom:14px' }, openGoals.map(g => goalRow(g, prs, container, root)));
      staggerChildren(list);
      container.append(list);
    }
    if (achievedGoals.length) {
      container.append(el('div', { class: 'section-head', style: 'margin-top:10px' }, [el('h2', {}, 'Achieved')]));
      const list = el('div', { class: 'list' }, achievedGoals.map(g => goalRow(g, prs, container, root)));
      staggerChildren(list);
      container.append(list);
    }
  }
}

async function renderPRsView(container, root) {
  const { prs } = await loadExtras();
  container.innerHTML = '';
  container.append(backHeader('Personal records', container, root));
  if (!prs.length) {
    container.append(emptyState('🏆', 'Log workouts to start tracking PRs.'));
  } else {
    const list = el('div', { class: 'list' }, prs.map(prRow));
    staggerChildren(list);
    container.append(list);
  }
}

async function renderWeightPlannerSubView(container, root) {
  container.innerHTML = '';
  container.append(backHeader('Weight planner', container, root));
  const body = el('div');
  container.append(body);
  await renderWeightPlanner(body, root);
}

// ── Alerts (push notifications) ──────────────────────────────────────────────
async function renderAlertsView(container, root) {
  const pushState = await getPushState();
  const prefs = await loadNotifPrefs().catch(() => {
    const fallback = {};
    for (const t of NOTIF_TYPES) fallback[t.key] = true;
    return fallback;
  });

  container.innerHTML = '';
  container.append(backHeader('Alerts', container, root));

  if (!pushState.supported) {
    container.append(emptyState('🔕', 'Push notifications aren\'t supported on this device/browser.'));
    return;
  }

  const statusText = pushState.permission === 'denied'
    ? 'Blocked — enable notifications for this site in your browser/phone settings.'
    : pushState.subscribed ? 'Notifications are on for this device.' : 'Notifications are off.';

  const masterBtn = el('button', {
    class: 'btn btn-primary btn-block',
    disabled: pushState.permission === 'denied',
    onClick: async () => {
      masterBtn.disabled = true;
      try {
        if (pushState.subscribed) {
          await disablePush();
          toast('Notifications turned off', 'ok');
        } else {
          await enablePush();
          toast('Notifications enabled 🔔', 'ok');
        }
        renderAlertsView(container, root);
      } catch (ex) {
        toast(ex.message || 'Failed', 'err');
        masterBtn.disabled = false;
      }
    }
  }, pushState.subscribed ? 'Turn off notifications' : 'Enable notifications');

  container.append(
    el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:16px' }, [
      el('div', { class: 'dim', style: 'font-size:13px;margin-bottom:12px' }, statusText),
      masterBtn
    ])
  );

  if (pushState.subscribed) {
    const rows = NOTIF_TYPES.map(t => {
      const checkbox = el('input', { type: 'checkbox' });
      checkbox.checked = prefs[t.key];
      checkbox.addEventListener('change', async () => {
        prefs[t.key] = checkbox.checked;
        try {
          await saveNotifPrefs(prefs);
        } catch (ex) {
          toast(ex.message || 'Failed to save', 'err');
          checkbox.checked = !checkbox.checked;
          prefs[t.key] = checkbox.checked;
        }
      });
      return el('label', { class: 'card item', style: 'align-items:center;gap:10px' }, [
        checkbox, el('div', { class: 'grow' }, [el('div', { class: 'title' }, t.label)])
      ]);
    });
    container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Notify me about')]));
    const list = el('div', { class: 'list' }, rows);
    staggerChildren(list);
    container.append(list);
  }

  container.append(el('div', { class: 'dim', style: 'font-size:12px;margin-top:16px' },
    'On iPhone: install this app to your Home Screen first (Share → Add to Home Screen), then enable notifications from there — iOS only delivers push to installed home-screen apps.'));
}

async function renderMeasurementsView(container, root) {
  container.innerHTML = '';
  container.append(backHeader('Measurements', container, root));
  const body = el('div');
  container.append(body);
  await renderMeasurements(body, root);
}

async function renderPhotosView(container, root) {
  container.innerHTML = '';
  container.append(backHeader('Progress photos', container, root));
  const body = el('div');
  container.append(body);
  await renderPhotos(body, root);
}

async function renderHistoryView(container, root) {
  container.innerHTML = '';
  container.append(backHeader('Workout history', container, root));
  const body = el('div');
  container.append(body);
  await renderWorkoutCalendar(body, root);
}

// ── Inventory (owned themes, banners, boosters) ─────────────────────────────
async function renderInventoryView(container, root) {
  const state = await loadShopState();
  container.innerHTML = '';
  container.append(backHeader('Inventory', container, root));

  const ownedThemes = state.inventory.filter(i => i.item_type === 'theme');
  const ownedBanners = state.inventory.filter(i => i.item_type === 'banner');
  const ownedBoosters = state.inventory.filter(i => i.item_type === 'booster');
  const activeBooster = state.settings?.active_booster;
  const activeLive = activeBooster && new Date(activeBooster.expires_at) > new Date();

  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Themes')]));
  if (!ownedThemes.length) {
    container.append(emptyState('🎨', 'No purchased themes yet — the Shop has more.'));
  } else {
    const list = el('div', { class: 'list', style: 'margin-bottom:20px' }, ownedThemes.map(i => {
      const t = SHOP_ITEMS.themes.find(x => x.code === i.item_code);
      if (!t) return null;
      const equipped = (state.settings?.equipped_theme || 'default') === t.code;
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb', style: `background:${t.colors.primary}` }, '🎨'),
        el('div', { class: 'grow' }, [el('div', { class: 'title' }, t.name)]),
        equipped
          ? el('span', { class: 'pill sold' }, 'Equipped')
          : el('button', { class: 'btn btn-sm btn-primary', onClick: () => equipTheme(t, () => renderInventoryView(container, root)) }, 'Equip')
      ]);
    }).filter(Boolean));
    staggerChildren(list);
    container.append(list);
  }

  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Banners')]));
  if (!ownedBanners.length) {
    container.append(emptyState('🏳️', 'No purchased banners yet — the Shop has more.'));
  } else {
    const list = el('div', { class: 'list', style: 'margin-bottom:20px' }, ownedBanners.map(i => {
      const b = SHOP_ITEMS.banners.find(x => x.code === i.item_code);
      if (!b) return null;
      const equipped = state.settings?.equipped_banner === b.code;
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb', style: `background:${b.gradient}` }, ''),
        el('div', { class: 'grow' }, [el('div', { class: 'title' }, b.name)]),
        equipped
          ? el('span', { class: 'pill sold' }, 'Equipped')
          : el('button', { class: 'btn btn-sm btn-primary', onClick: () => equipBanner(b, () => renderInventoryView(container, root)) }, 'Equip')
      ]);
    }).filter(Boolean));
    staggerChildren(list);
    container.append(list);
  }

  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Boosters')]));
  if (!ownedBoosters.length) {
    container.append(emptyState('⚡', 'No boosters owned — buy some from the Shop.'));
  } else {
    const list = el('div', { class: 'list' }, ownedBoosters.map(i => {
      const b = SHOP_ITEMS.boosters.find(x => x.code === i.item_code);
      if (!b) return null;
      return el('div', { class: 'card item' }, [
        el('div', { class: 'thumb' }, '⚡'),
        el('div', { class: 'grow' }, [
          el('div', { class: 'title' }, b.name),
          el('div', { class: 'sub' }, `${b.multiplier}× XP for ${b.durationMinutes} min · Own ${i.quantity}`)
        ]),
        el('button', {
          class: 'btn btn-sm btn-ghost', disabled: activeLive,
          onClick: () => activateOwnedBooster(b, () => renderInventoryView(container, root))
        }, activeLive ? 'Active…' : 'Activate')
      ]);
    }).filter(Boolean));
    staggerChildren(list);
    container.append(list);
  }
}

async function renderAchievementsSubView(container, root) {
  const progress = await loadProgress();
  const workouts = await loadOwnWorkoutDates();
  const streak = await computeStreak(workouts);
  const stats = await loadStats(progress, streak.current);
  const achievementsView = await loadAchievementsView(stats);

  container.innerHTML = '';
  container.append(backHeader('Achievements', container, root));
  const achList = el('div', { class: 'list' }, achievementsView.map(achievementRow));
  staggerChildren(achList);
  container.append(achList);
}

// ── Weekend event banner ─────────────────────────────────────────────────────
function weekendEventBanner() {
  const msLeft = weekendEventMsLeft();
  if (msLeft == null) return null;
  const totalMins = Math.max(1, Math.round(msLeft / 60000));
  const hours = Math.floor(totalMins / 60), mins = totalMins % 60;
  const label = hours >= 24
    ? `${Math.ceil(hours / 24)}d left`
    : `${hours}h ${mins}m left`;
  return el('div', { class: 'card weekend-event-banner' }, [
    el('div', { style: 'font-weight:800' }, '⚡ Double XP & Plates all weekend'),
    el('div', { class: 'dim', style: 'font-size:12px;margin-top:2px' }, label)
  ]);
}

// ── Status header (Lv/XP · streak · Plates) ─────────────────────────────────
function statusHeader(progress, streak) {
  const need = xpToNext(progress);
  const pct = Math.min(100, (Number(progress.xp) / need) * 100);
  const xpValEl = el('span', {});
  const plateEl = el('span', {});

  const row = el('div', { class: 'profile-status-row' }, [
    el('div', { class: 'profile-status-lv' }, [
      el('span', { class: 'profile-lv-badge' }, `Lv.${progress.level}`),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'meter profile-lv-meter' }, [el('div', { class: 'meter-fill', style: `width:${pct.toFixed(1)}%` })]),
        el('div', { class: 'profile-lv-xp' }, [xpValEl, el('span', { class: 'dim' }, ` / ${num(need)} XP`)])
      ])
    ]),
    el('div', {
      class: 'profile-status-stat',
      title: streak.longest > streak.current ? `Best: ${streak.longest} weeks` : undefined
    }, [
      el('span', {}, '🔥'), el('span', {}, String(streak.current)),
      streak.freezesLeft > 0 ? el('span', { class: 'dim', style: 'font-size:11px;margin-left:1px' }, `🧊${streak.freezesLeft}`) : null
    ]),
    el('div', { class: 'profile-status-stat' }, [el('span', {}, '💠'), plateEl]),
    muteToggle()
  ]);
  countUp(xpValEl, Number(progress.xp), num);
  countUp(plateEl, Number(progress.plates), num);
  return row;
}

function muteToggle() {
  const btn = el('button', {
    type: 'button', class: 'profile-mute-btn', title: isMuted() ? 'Unmute sounds' : 'Mute sounds',
    onClick: () => { const muted = toggleMuted(); btn.textContent = muted ? '🔇' : '🔊'; btn.title = muted ? 'Unmute sounds' : 'Mute sounds'; }
  }, isMuted() ? '🔇' : '🔊');
  return btn;
}

// ── Hero banner (avatar + username + title + rank) ──────────────────────────
function heroBanner(profile, progress, bannerGradient, overallRank, container, root) {
  const cap = maxLevelForTrack(progress);
  const atCap = progress.level >= cap;
  const title = progress.is_master ? MASTER_TITLE : (PRESTIGE_TITLES[progress.prestige] || PRESTIGE_TITLES[0]);
  const heroBg = bannerGradient || 'linear-gradient(160deg,var(--bg2),var(--bg))';

  return el('div', { class: 'profile-hero', style: `background:${heroBg}` }, [
    el('div', { class: 'profile-hero-top' }, [
      el('div', {}, [
        el('div', { class: 'profile-hero-username' }, '@' + (profile?.username || '—')),
        el('div', { class: 'profile-hero-title' }, title)
      ]),
      rankBadge(overallRank)
    ]),
    el('div', { class: 'profile-hero-avatar-wrap' }, [renderAvatar(profile, { size: 150 })]),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:4px' }, [
      el('button', {
        type: 'button', class: 'btn btn-sm btn-ghost profile-customize-btn',
        onClick: () => openAvatarCustomizer(profile, container, root)
      }, '✎ Customize'),
      atCap && !progress.is_master ? el('button', {
        type: 'button', class: 'btn btn-sm btn-primary',
        onClick: () => doPrestige(container, root)
      }, progress.prestige + 1 >= MAX_PRESTIGE ? '⭐ Master Prestige' : '⭐ Prestige') : null
    ])
  ]);
}

function openAvatarCustomizer(profile, container, root) {
  avatarCustomizer(profile, () => renderProgress(container, root));
}

function doPrestige(container, root) {
  confirmModal({
    title: 'Prestige?',
    message: 'Your level resets to 1. You keep your Plates, PRs, and goals. Prestige is permanent.',
    confirmText: 'Prestige',
    danger: false,
    onConfirm: async () => {
      const result = await prestige();
      toast(result.enteredMaster ? 'Master Prestige unlocked! 👑' : 'Prestiged! ⭐', 'ok');
      celebrate();
      renderProgress(container, root);
    }
  });
}

// ── Shortcut grid ─────────────────────────────────────────────────────────
function shortcutGrid(profile, container, root) {
  const items = [
    { icon: '📜', label: 'Quests', onClick: () => goProfileView('quests', container, root) },
    { icon: '🎯', label: 'Goals', onClick: () => goProfileView('goals', container, root) },
    { icon: '🏆', label: 'Records', onClick: () => goProfileView('prs', container, root) },
    { icon: '🎖️', label: 'Medals', onClick: () => goProfileView('achievements', container, root) },
    { icon: '🎒', label: 'Inventory', onClick: () => goProfileView('inventory', container, root) },
    { icon: '⚖️', label: 'Weight planner', onClick: () => goProfileView('weight-planner', container, root) },
    { icon: '📏', label: 'Measurements', onClick: () => goProfileView('measurements', container, root) },
    { icon: '📸', label: 'Progress', onClick: () => goProfileView('photos', container, root) },
    { icon: '📅', label: 'History', onClick: () => goProfileView('history', container, root) },
    { icon: '🔔', label: 'Alerts', onClick: () => goProfileView('alerts', container, root) },
    { icon: '🏋️', label: 'Plates', onClick: () => plateCalculatorModal() },
    { icon: '🏅', label: 'Ranks', onClick: () => goToSegment('ranks', root) },
    { icon: '🛒', label: 'Shop', onClick: () => goToSegment('shop', root) },
    { icon: '🗓️', label: 'Routines', onClick: () => goToSegment('train', root) },
    { icon: '✎', label: 'Customize', onClick: () => openAvatarCustomizer(profile, container, root) }
  ];
  return el('div', { class: 'profile-grid' }, items.map(i => el('div', {
    class: 'profile-grid-tile', onClick: i.onClick
  }, [
    el('div', { class: 'profile-grid-icon' }, i.icon),
    el('div', { class: 'profile-grid-label' }, i.label)
  ])));
}

// ── Memories (week-at-a-glance) ──────────────────────────────────────────────
function memoriesCard(workouts) {
  const workoutDates = new Set(workouts.map(w => w.workout_date));
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const todayIso = todayISO();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push(d);
  }
  return el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:20px' }, [
    el('div', { class: 'section-head', style: 'margin:0 0 12px' }, [el('h2', {}, '📅 Memories')]),
    el('div', { class: 'memories-row' }, days.map((d, i) => {
      const iso = isoOf(d);
      const has = workoutDates.has(iso);
      const isToday = iso === todayIso;
      return el('div', { class: 'memories-day' + (has ? ' has-workout' : '') + (isToday ? ' is-today' : '') }, [
        el('div', { class: 'memories-dow' }, labels[i]),
        el('div', { class: 'memories-date' }, String(d.getDate()))
      ]);
    }))
  ]);
}

function questRow(q, weekStart, onCooldown, container, root) {
  const pct = q.target ? Math.min(100, (q.progress / q.target) * 100) : 0;
  const status = q.claimed
    ? el('span', { class: 'pill' }, 'Claimed')
    : q.completed
      ? (onCooldown
          ? el('span', { class: 'pill' }, '⏳ Cooldown')
          : el('button', { class: 'btn btn-sm btn-primary', onClick: () => doClaimQuest(q, weekStart, container, root) }, `Claim`))
      : el('span', { class: 'dim', style: 'font-size:12px' }, `${q.progress}/${q.target}`);
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, q.icon),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, q.label),
      el('div', { class: 'sub' }, `+${num(q.xp)} XP · +${num(q.plates)} Plates`),
      el('div', { class: 'meter', style: 'margin-top:6px' }, [el('div', { class: 'meter-fill', style: `width:${pct}%` })])
    ]),
    status
  ]);
}

async function doClaimQuest(q, weekStart, container, root) {
  try {
    const gains = await claimQuest(q, weekStart);
    toast(`+${q.xp} XP · +${q.plates} Plates`, 'ok');
    if (gains?.levelsGained > 0) celebrate();
    renderProgress(container, root);
  } catch (ex) {
    toast(ex.message || 'Failed to claim', 'err');
  }
}

function achievementRow(a) {
  return el('div', { class: 'card item', style: a.unlocked ? '' : 'opacity:.55' }, [
    el('div', { class: 'thumb' }, a.icon),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, a.label),
      el('div', { class: 'sub' }, a.unlocked
        ? `Unlocked ${fmtDate((a.unlockedAt || '').slice(0, 10))}`
        : `${Math.min(a.value, a.target)}/${a.target}`)
    ]),
    a.unlocked ? el('span', { class: 'pill' }, '✓') : null
  ]);
}

function goalRow(g, prs, container, root) {
  const pr = prs.find(p => p.exercise === g.exercise);
  const current = pr ? Number(pr.best_weight) : 0;
  const target = Number(g.target_weight);
  const pct = target ? Math.min(100, (current / target) * 100) : 0;
  return el('div', { class: 'card item', onClick: () => goalActions(g, container, root) }, [
    el('div', { class: 'thumb' }, g.achieved ? '✅' : '🎯'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, `${g.exercise} — ${fmtWeight(target)}${g.target_reps > 1 ? ` ×${g.target_reps}` : ''}`),
      el('div', { class: 'sub' }, g.achieved
        ? `Achieved ${fmtDate((g.achieved_at || '').slice(0, 10))}`
        : `Current: ${fmtWeight(current)} (${pct.toFixed(0)}%)`)
    ])
  ]);
}

function goalActions(g, container, root) {
  actionSheet(g.exercise, [
    { label: '🗑️ Delete', danger: true, onClick: () => {
      confirmModal({
        title: 'Delete goal?', confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('fitness_goals').delete().eq('id', g.id);
          if (error) throw error;
          toast('Deleted');
          renderProgress(container, root);
        }
      });
    } }
  ]);
}

function addGoalForm(container, root) {
  formModal({
    title: 'New goal',
    fields: [
      { name: 'exercise', label: 'Exercise', required: true, placeholder: 'e.g. Bench Press' },
      { name: 'target_weight', label: `Target weight (${weightUnit()})`, type: 'number', step: String(weightStep()), min: '0', required: true },
      { name: 'target_reps', label: 'For at least this many reps (optional)', type: 'number', step: '1', min: '1', value: 1 }
    ],
    submitText: 'Set goal',
    onSubmit: async v => {
      const { error } = await sb.from('fitness_goals')
        .insert({ ...v, target_weight: displayToKg(v.target_weight), user_id: getUid() });
      if (error) throw error;
      toast('Goal set 🎯', 'ok');
      renderProgress(container, root);
    }
  });
}

function prRow(p) {
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '🏆'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, p.exercise),
      el('div', { class: 'sub' },
        `${fmtWeight(p.best_weight)} × ${p.best_reps} · e1RM ~${fmtWeight(p.best_e1rm)} · ${fmtDate((p.achieved_at || '').slice(0, 10))}`)
    ])
  ]);
}
