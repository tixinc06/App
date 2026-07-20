// Reusable monthly P&L calendar (trading-journal style): a month grid where each
// day shows that day's realized profit + sale count, colored green/red.
import { el, money, todayISO } from './ui.js';

// dayTotals: Map/object of 'YYYY-MM-DD' -> { profit: number, count: number }
// onDayClick(dateISO) is called when a day with sales is tapped.
// Returns { node, setMonth(y,m) } — the caller owns navigation state.
export function plCalendar({ year, month, dayTotals, onDayClick, onNav }) {
  const card = el('div', { class: 'card cal-card' });
  render();
  return card;

  function render() {
    card.innerHTML = '';
    const monthStart = new Date(year, month, 1);
    const monthTotal = Object.entries(dayTotals)
      .filter(([d]) => d.slice(0, 7) === isoMonth(year, month))
      .reduce((a, [, v]) => a + v.profit, 0);

    card.append(
      el('div', { class: 'cal-header' }, [
        el('div', { class: 'pl-label' }, 'Monthly P/L'),
        el('div', { class: 'pl-value ' + (monthTotal > 0 ? 'pos' : monthTotal < 0 ? 'neg' : '') }, money(monthTotal))
      ]),
      el('div', { class: 'cal-nav' }, [
        el('button', { class: 'btn btn-sm btn-ghost', onClick: () => onNav(-1) }, '‹'),
        el('div', { class: 'month-label' }, monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        el('button', { class: 'btn btn-sm btn-ghost', onClick: () => onNav(1) }, '›')
      ]),
      grid()
    );
  }

  function grid() {
    const g = el('div', { class: 'cal-grid' });
    for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) g.append(el('div', { class: 'cal-dow' }, d));

    const firstDow = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const today = todayISO();
    const cellsNeeded = Math.ceil((firstDow + daysInMonth) / 7) * 7;

    for (let i = 0; i < cellsNeeded; i++) {
      const dayNum = i - firstDow + 1;
      let cellDate, otherMonth = false, label;
      if (dayNum < 1) {
        cellDate = new Date(year, month - 1, daysInPrev + dayNum);
        otherMonth = true; label = daysInPrev + dayNum;
      } else if (dayNum > daysInMonth) {
        cellDate = new Date(year, month + 1, dayNum - daysInMonth);
        otherMonth = true; label = dayNum - daysInMonth;
      } else {
        cellDate = new Date(year, month, dayNum);
        label = dayNum;
      }
      const iso = isoOf(cellDate);
      const t = dayTotals[iso];
      const cls = ['cal-day'];
      if (otherMonth) cls.push('other-month');
      if (iso === today) cls.push('today');
      if (t) {
        cls.push('has-sales', t.profit >= 0 ? 'pos' : 'neg');
      }
      const cell = el('div', { class: cls.join(' '), onClick: t && !otherMonth ? () => onDayClick(iso) : null }, [
        el('div', { class: 'd-num' }, String(label)),
        t ? el('div', { class: 'd-pl' }, money(t.profit)) : null,
        t ? el('div', { class: 'd-cnt' }, `${t.count} sale${t.count === 1 ? '' : 's'}`) : null
      ]);
      g.append(cell);
    }
    return g;
  }
}

function isoOf(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isoMonth(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }
