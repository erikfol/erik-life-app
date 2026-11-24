// Appointments (Pets, and Health's General Health, Dental and Eye): the next one, for the banner at the top of a page.
import { isoDate, daysBetween, dateOf } from './dates.js';

/**
 * The appointment banner at the top of a page: the next appointment on or after `today` (rows with a YYYY-MM-DD Date).
 * { level: 'none' } (red) when there isn't one, 'soon' (yellow) when it's within 14 days, else 'later' (green);
 * with next (the row) and days (0 = today).
 */
export function appointmentStatus(rows, today = new Date()) {
    const SOON_DAYS = 14;
    const todayIso = isoDate(today);
    const next = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.Date || '') && r.Date >= todayIso)
        .sort((a, b) => a.Date.localeCompare(b.Date) || String(a.Time || '').localeCompare(String(b.Time || '')))[0];
    if (!next) return { level: 'none' };
    const days = daysBetween(today, dateOf(next.Date));
    return { level: days <= SOON_DAYS ? 'soon' : 'later', next, days };
}
