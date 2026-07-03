import { useState } from 'react';
import { IconBack, IconChevron } from '../shared/icons';
import { dayKey, fmtMonth, monthGrid, startOfDay, weekdaysShort } from '../shared/russian';
import { t } from '../shared/i18n';

/**
 * Compact month grid (8C): dots mark days with reminders; tapping a day
 * shows that day's list below. Cells are tap-friendly, the grid never
 * dominates the screen.
 */
export function Calendar(props: {
  selected: number | null;
  onSelect: (dayTs: number) => void;
  marks: Set<string>;
  minDate?: number;
  onMonthChange?: (year: number, month: number) => void;
}) {
  const initial = new Date(props.selected || Date.now());
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());

  const cells = monthGrid(year, month);
  const todayTs = startOfDay(Date.now());

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    props.onMonthChange?.(d.getFullYear(), d.getMonth());
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-ghost" style={{ minWidth: 56 }} onClick={() => shift(-1)} aria-label={t('Прошлый месяц')}>
          <IconBack size={24} />
        </button>
        <div className="grow center" style={{ fontSize: 20, fontWeight: 700, textTransform: 'capitalize' }}>
          {fmtMonth(year, month)}
        </div>
        <button className="btn btn-ghost" style={{ minWidth: 56 }} onClick={() => shift(1)} aria-label={t('Следующий месяц')}>
          <IconChevron size={24} />
        </button>
      </div>
      <div className="cal-grid" style={{ marginBottom: 4 }}>
        {weekdaysShort().map((d) => (
          <div key={d} className="cal-head">
            {d}
          </div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell) => {
          const isPast = props.minDate !== undefined && cell.ts < startOfDay(props.minDate);
          const classes = [
            'cal-day',
            cell.inMonth ? '' : 'other',
            cell.ts === todayTs ? 'today' : '',
            props.selected !== null && cell.ts === startOfDay(props.selected) ? 'selected' : '',
            isPast ? 'past' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={cell.ts}
              className={classes}
              disabled={isPast}
              onClick={() => props.onSelect(cell.ts)}
            >
              {cell.day}
              {props.marks.has(dayKey(cell.ts)) ? <span className="dot" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Big, forgiving 24-hour time stepper — no tiny native controls (8C). */
export function TimeStepper(props: { hour: number; minute: number; onChange: (hour: number, minute: number) => void }) {
  const changeHour = (delta: number) => {
    props.onChange((props.hour + delta + 24) % 24, props.minute);
  };
  const changeMinute = (delta: number) => {
    const next = (props.minute + delta + 60) % 60;
    props.onChange(props.hour, next);
  };
  const two = (n: number) => String(n).padStart(2, '0');

  const col = (value: string, up: () => void, down: () => void, labelUp: string, labelDown: string) => (
    <div className="stack" style={{ gap: 8, alignItems: 'center', flex: '0 0 auto' }}>
      <button className="btn btn-soft" style={{ width: 96 }} onClick={up} aria-label={labelUp}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>▲</span>
      </button>
      <div className="num" style={{ fontSize: 52, fontWeight: 700, width: 96, textAlign: 'center' }}>
        {value}
      </div>
      <button className="btn btn-soft" style={{ width: 96 }} onClick={down} aria-label={labelDown}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>▼</span>
      </button>
    </div>
  );

  return (
    <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
      {col(two(props.hour), () => changeHour(1), () => changeHour(-1), t('Час больше'), t('Час меньше'))}
      <div style={{ fontSize: 44, fontWeight: 700 }}>:</div>
      {col(two(props.minute), () => changeMinute(5), () => changeMinute(-5), t('Минуты больше'), t('Минуты меньше'))}
    </div>
  );
}
