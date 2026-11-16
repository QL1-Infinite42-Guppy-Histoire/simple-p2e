// JST date helpers. JST is UTC+9 with no DST, so fixed-offset math is exact.
// All game days / weeks are JST days (DESIGN.md: daily seed, daily best).

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function jstDateString(nowMs = Date.now()) {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Monday (YYYY-MM-DD) of the week containing dateStr.
export function weekMonday(dateStr) {
  const ms = parseDateStr(dateStr);
  const dow = new Date(ms).getUTCDay(); // 0=Sun .. 6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  return formatUtc(ms - diff * 86400000);
}

// The 7 date strings (Mon..Sun) of the week containing dateStr.
export function weekDates(dateStr) {
  const monday = parseDateStr(weekMonday(dateStr));
  return Array.from({ length: 7 }, (_, i) => formatUtc(monday + i * 86400000));
}

// --- Seasons (DESIGN.md §3.4, user decision 2026-11-17) ---------------------
// A season is a half month, closing at the start and the middle of the
// month: the 1st..15th, and the 16th..last day of the month (JST).

// First date (YYYY-MM-DD) of the season containing dateStr.
export function seasonStart(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = d <= 15 ? 1 : 16;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// All date strings of the season containing dateStr.
export function seasonDates(dateStr) {
  const start = seasonStart(dateStr);
  const [y, m] = start.split("-").map(Number);
  const lastDay = start.endsWith("-01") ? 15 : new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = start.endsWith("-01") ? 1 : 16;
  return Array.from({ length: lastDay - first + 1 }, (_, i) =>
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(first + i).padStart(2, "0")}`);
}
