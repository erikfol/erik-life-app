// Appointments (Pets, and Health's General Health, Dental and Eye): the next one, for the banner at the top of a page.

/**
 * The appointment banner at the top of a page: the next appointment on or after `today` (rows with a YYYY-MM-DD Date).
 * { level: 'none' } (red) when there isn't one, 'soon' (yellow) when it's within 14 days, else 'later' (green);
 * with next (the row) and days (0 = today).
 */
export function appointmentStatus(rows, today = new Date()) {
    const SOON_DAYS = 14;
    const pad = n => String(n).padStart(2, '0');
    const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const next = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.Date || '') && r.Date >= todayIso)
        .sort((a, b) => a.Date.localeCompare(b.Date) || String(a.Time || '').localeCompare(String(b.Time || '')))[0];
    if (!next) return { level: 'none' };
    const [y, m, d] = next.Date.split('-').map(Number);
    const days = Math.round((new Date(y, m - 1, d) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    return { level: days <= SOON_DAYS ? 'soon' : 'later', next, days };
}
