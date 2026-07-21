// Progress tab: level/XP bar, Plates balance, manual Prestige, goals
// ("100kg bench" etc.), and personal-record history.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, toast, formModal, confirmModal, actionSheet, emptyState,
  skeleton, staggerChildren, countUp, celebrate
} from './ui.js';
import { loadProgress, xpToNext, maxLevelForTrack, prestige } from './progression.js';
import { MAX_PRESTIGE, SHOP_ITEMS, PRESTIGE_TITLES, MASTER_TITLE } from './gamedata.js';
import { computeStreak } from './streaks.js';
import { loadStats, loadAchievementsView } from './achievements.js';
import { loadQuestProgress, claimQuest } from './quests.js';

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

export async function renderProgress(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let progress, extras, bannerGradient, streak, achievementsView, questsView;
  try {
    progress = await loadProgress();
    extras = await loadExtras();
    bannerGradient = await loadBannerGradient();
    const workouts = await loadOwnWorkoutDates();
    streak = await computeStreak(workouts);
    const stats = await loadStats(progress, streak.current);
    achievementsView = await loadAchievementsView(stats);
    questsView = await loadQuestProgress(workouts, extras.prs, extras.goals);
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load progress. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  const onCooldown = !!(progress.xp_cooldown_until && new Date(progress.xp_cooldown_until) > new Date());

  container.append(levelCard(progress, bannerGradient, container, root));
  container.append(streakCard(streak));

  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Weekly quests')]));
  const questList = el('div', { class: 'list', style: 'margin-bottom:22px' }, questsView.quests.map(q => questRow(q, questsView.weekStart, onCooldown, container, root)));
  staggerChildren(questList);
  container.append(questList);

  const { prs, goals } = extras;
  const openGoals = goals.filter(g => !g.achieved);
  const achievedGoals = goals.filter(g => g.achieved);

  container.append(el('div', { class: 'section-head' }, [
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

  container.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Personal records')]));
  if (!prs.length) {
    container.append(emptyState('🏆', 'Log workouts to start tracking PRs.'));
  } else {
    const list = el('div', { class: 'list' }, prs.map(prRow));
    staggerChildren(list);
    container.append(list);
  }

  container.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Achievements')]));
  const achList = el('div', { class: 'list' }, achievementsView.map(achievementRow));
  staggerChildren(achList);
  container.append(achList);
}

function streakCard(streak) {
  return el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between' }, [
    el('div', {}, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Weekly streak'),
      el('div', { style: 'font-size:22px;font-weight:800;margin-top:4px' }, `🔥 ${streak.current} week${streak.current === 1 ? '' : 's'}`),
      streak.longest > streak.current ? el('div', { class: 'dim', style: 'font-size:12px;margin-top:2px' }, `Best: ${streak.longest} weeks`) : null
    ]),
    streak.freezesLeft > 0 ? el('div', { style: 'text-align:right' }, [
      el('div', { class: 'k', style: 'font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Freezes'),
      el('div', { style: 'font-size:18px;font-weight:800;color:var(--blue)' }, `🧊 ${streak.freezesLeft}`)
    ]) : null
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

function levelCard(progress, bannerGradient, container, root) {
  const need = xpToNext(progress);
  const cap = maxLevelForTrack(progress);
  const atCap = progress.level >= cap;
  const pct = Math.min(100, (Number(progress.xp) / need) * 100);
  const title = progress.is_master ? MASTER_TITLE : (PRESTIGE_TITLES[progress.prestige] || PRESTIGE_TITLES[0]);
  const prestigeLabel = progress.is_master
    ? `${title} · Master Prestige · Level ${progress.level}`
    : `${title} · Prestige ${progress.prestige} · Level ${progress.level}`;

  const xpValEl = el('span', {});
  const platesValEl = el('span', {});

  const card = el('div', { class: 'card', style: 'padding:18px;margin-bottom:20px' }, [
    bannerGradient ? el('div', {
      style: `height:5px;background:${bannerGradient};border-radius:12px 12px 0 0;margin:-18px -18px 14px -18px`
    }) : null,
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between' }, [
      el('div', {}, [
        el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, prestigeLabel),
        el('div', { style: 'font-size:26px;font-weight:800;margin-top:4px' }, [
          xpValEl,
          el('span', { class: 'dim', style: 'font-size:14px' }, ` / ${num(need)} XP`)
        ])
      ]),
      el('div', { style: 'text-align:right' }, [
        el('div', { class: 'k', style: 'font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Plates'),
        el('div', { style: 'font-size:20px;font-weight:800;color:var(--amber)' }, [platesValEl])
      ])
    ]),
    el('div', { class: 'meter', style: 'margin-top:12px' }, [
      el('div', { class: 'meter-fill', style: `width:${pct.toFixed(1)}%` })
    ]),
    atCap && !progress.is_master ? el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:14px',
      onClick: () => doPrestige(container, root)
    }, progress.prestige + 1 >= MAX_PRESTIGE ? '⭐ Enter Master Prestige' : `⭐ Prestige (${progress.prestige} → ${progress.prestige + 1})`) : null
  ]);
  countUp(xpValEl, Number(progress.xp), num);
  countUp(platesValEl, Number(progress.plates), num);
  return card;
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

function goalRow(g, prs, container, root) {
  const pr = prs.find(p => p.exercise === g.exercise);
  const current = pr ? Number(pr.best_weight) : 0;
  const target = Number(g.target_weight);
  const pct = target ? Math.min(100, (current / target) * 100) : 0;
  return el('div', { class: 'card item', onClick: () => goalActions(g, container, root) }, [
    el('div', { class: 'thumb' }, g.achieved ? '✅' : '🎯'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, `${g.exercise} — ${num(target)}kg${g.target_reps > 1 ? ` ×${g.target_reps}` : ''}`),
      el('div', { class: 'sub' }, g.achieved
        ? `Achieved ${fmtDate((g.achieved_at || '').slice(0, 10))}`
        : `Current: ${num(current)}kg (${pct.toFixed(0)}%)`)
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
      { name: 'target_weight', label: 'Target weight (kg)', type: 'number', step: '0.5', min: '0', required: true },
      { name: 'target_reps', label: 'For at least this many reps (optional)', type: 'number', step: '1', min: '1', value: 1 }
    ],
    submitText: 'Set goal',
    onSubmit: async v => {
      const { error } = await sb.from('fitness_goals').insert({ ...v, user_id: getUid() });
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
        `${num(p.best_weight)}kg × ${p.best_reps} · e1RM ~${num(p.best_e1rm)}kg · ${fmtDate((p.achieved_at || '').slice(0, 10))}`)
    ])
  ]);
}
