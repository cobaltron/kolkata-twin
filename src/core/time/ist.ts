/**
 * Calendar helpers in Indian Standard Time (UTC+05:30, no DST).
 *
 * Simplification: IST is applied to every year on the slider. Before the 20th-century
 * standardisation Calcutta kept its own local mean time (commonly cited as UTC+05:53:20 —
 * UNVERIFIED here). The error is under 24 minutes of clock time and does not affect which
 * features exist in a given year.
 */
export const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const MS_PER_DAY = 86400000;

export interface IstParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 1-366 */
  dayOfYear: number;
  /** Fractional hours since local midnight, [0, 24). */
  hours: number;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
export function daysInYear(y: number): number {
  return isLeapYear(y) ? 366 : 365;
}

/** Epoch ms of local midnight on 1 January of `year`, IST. */
function istYearStart(year: number): number {
  return Date.UTC(year, 0, 1) - IST_OFFSET_MS;
}

export function toIst(instant: number): IstParts {
  const shifted = new Date(instant + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const sinceYearStart = instant - istYearStart(year);
  const dayIndex = Math.floor(sinceYearStart / MS_PER_DAY);
  return {
    year,
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayOfYear: dayIndex + 1,
    hours: (sinceYearStart - dayIndex * MS_PER_DAY) / 3600000,
  };
}

/** Build an instant from IST calendar parts. dayOfYear is clamped to the year's length. */
export function fromIst(year: number, dayOfYear: number, hours: number): number {
  const d = Math.min(Math.max(1, Math.round(dayOfYear)), daysInYear(year));
  return istYearStart(year) + (d - 1) * MS_PER_DAY + hours * 3600000;
}

/** Same month/day/time in a different year (29 Feb maps to 28 Feb in non-leap years). */
export function withYear(instant: number, year: number): number {
  const p = toIst(instant);
  const day = p.month === 2 && p.day === 29 && !isLeapYear(year) ? 28 : p.day;
  return Date.UTC(year, p.month - 1, day) - IST_OFFSET_MS + p.hours * 3600000;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatIst(instant: number): string {
  const p = toIst(instant);
  const h = Math.floor(p.hours);
  const m = Math.floor((p.hours - h) * 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(h)}:${pad(m)} IST`;
}
