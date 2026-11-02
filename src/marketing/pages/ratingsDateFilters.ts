/** One contiguous Saudi-calendar range controls both the ratings query and the selectors.
 * The ratings API limits requests to five years, so the "all years" selection
 * intentionally covers the current year and the previous four years.
 */
export type RatingPeriod = { from: string; to: string };
export type RatingCalendarSelection = RatingPeriod & { month: string; year: string };

export function selectionForRatingDates(from: string, to: string): Pick<RatingCalendarSelection, 'month' | 'year'> {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(from) || !valid.test(to) || from > to) return { month: 'all', year: 'all' };
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  return {
    year: fromYear === toYear ? fromYear : 'all',
    month: from.slice(0, 7) === to.slice(0, 7) ? from.slice(5, 7) : 'all',
  };
}

export function ratingDatesForSelection(month: string, year: string, today: string): RatingCalendarSelection {
  const currentYear = Number(today.slice(0, 4));
  const normalizedMonth = /^(0[1-9]|1[0-2])$/.test(month) ? month : 'all';
  // A specific month with "all years" cannot be expressed as one contiguous
  // interval. Choose the current year rather than show a misleading date range.
  const normalizedYear = /^\d{4}$/.test(year) ? year : (normalizedMonth === 'all' ? 'all' : String(currentYear));
  if (normalizedYear === 'all') {
    return { month: 'all', year: 'all', from: `${currentYear - 4}-01-01`, to: `${currentYear}-12-31` };
  }
  if (normalizedMonth === 'all') {
    return { month: 'all', year: normalizedYear, from: `${normalizedYear}-01-01`, to: `${normalizedYear}-12-31` };
  }
  const lastDay = new Date(Date.UTC(Number(normalizedYear), Number(normalizedMonth), 0)).getUTCDate();
  return { month: normalizedMonth, year: normalizedYear,
    from: `${normalizedYear}-${normalizedMonth}-01`,
    to: `${normalizedYear}-${normalizedMonth}-${String(lastDay).padStart(2, '0')}` };
}

export function isValidRatingPeriod(from: string, to: string): boolean {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T12:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  };
  return validDate(from) && validDate(to) && from <= to &&
    Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`) <= 366 * 5 * 86400000;
}
