import type { EmittedFile } from '../types';

/**
 * The calendar runtime the emitted project owns (`docs/31-calendar-chat.md`).
 *
 * Arithmetic on a `Date`, and nothing else. Working out which day a month starts on is four lines;
 * a date library is two hundred kilobytes and a lifetime of upgrades, and this is the same rule the
 * charts and the icons follow.
 */

const CALENDAR_RUNTIME = `/**
 * Calendar arithmetic (generated — docs/31-calendar-chat.md).
 *
 * Everything here works in **local time**, deliberately. A calendar is a picture of somebody's
 * month, and "the 3rd" means the 3rd where they are standing.
 */

export interface Day {
  /** The date this cell is, whichever month it belongs to. */
  date: Date;
  /** \`YYYY-MM-DD\`, which is how a date column spells it and how events are matched. */
  key: string;
  /** False for the days either side that fill the first and last week. */
  inMonth: boolean;
  today: boolean;
}

export interface Event {
  key: string;
  title: string;
  date: Date;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAYS_MONDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_SUNDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthName(year: number, month: number): string {
  return MONTHS[month] + ' ' + year;
}

/** Local \`YYYY-MM-DD\`. Not toISOString, which would shift the day for anyone east or west of UTC. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

/**
 * The six weeks a month grid draws.
 *
 * Always six, so the grid does not change height between March and April — a calendar that resizes
 * as you page through it makes everything under it jump.
 */
export function monthGrid(year: number, month: number, weekStartsMonday: boolean): Day[] {
  const first = new Date(year, month, 1);
  const offset = weekStartsMonday ? (first.getDay() + 6) % 7 : first.getDay();
  const start = new Date(year, month, 1 - offset);
  const todayKey = dayKey(new Date());

  return Array.from({ length: 42 }, (_unused, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKey(date);
    return { date, key, inMonth: date.getMonth() === month, today: key === todayKey };
  });
}

/**
 * Rows to events, keyed by the day they fall on.
 *
 * \`YYYY-MM-DD\` and a full ISO timestamp both work, because those are what a date column and a
 * timestamp column actually hold. Anything else is **skipped rather than guessed at**: a row landing
 * on the wrong day is worse than a row not showing.
 */
export function eventsByDay(
  rows: readonly Record<string, unknown>[],
  dateKey: string,
  titleKey: string,
): Map<string, Event[]> {
  const byDay = new Map<string, Event[]>();
  if (!dateKey) return byDay;

  for (const row of rows) {
    const raw = row[dateKey];
    if (raw === null || raw === undefined || raw === '') continue;

    const date = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(date.getTime())) continue;

    // A plain date has no time in it, and \`new Date("2026-03-04")\` is parsed as UTC midnight — which
    // is the previous day for anyone west of Greenwich. Read those as local instead.
    const plain = typeof raw === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(raw);
    const local = plain
      ? new Date(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)) - 1, Number(raw.slice(8, 10)))
      : date;

    const key = dayKey(local);
    const event: Event = { key, title: titleKey ? String(row[titleKey] ?? '') : '', date: local };
    const existing = byDay.get(key);
    if (existing) existing.push(event);
    else byDay.set(key, [event]);
  }

  return byDay;
}

/** Everything from today onwards, soonest first — what an agenda is. */
export function upcoming(byDay: Map<string, Event[]>, limit = 50): Event[] {
  const from = dayKey(new Date());
  return [...byDay.entries()]
    .filter(([key]) => key >= from)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, events]) => events)
    .slice(0, limit);
}

/** The time of day, when a row carries one. Empty for a plain date, which has no time to show. */
export function timeOf(date: Date): string {
  if (date.getHours() === 0 && date.getMinutes() === 0) return '';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}
`;

export function emitCalendarRuntime(): EmittedFile {
  return { path: 'src/calendar.ts', content: CALENDAR_RUNTIME };
}
