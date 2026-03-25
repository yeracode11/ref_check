/**
 * Единая логика: какие строки checkins.fridgeId относятся к холодильнику,
 * и как по дате визита получить today / week / old (для карты и отчётов).
 */

const DEFAULT_VISIT_TIMEZONE = 'Asia/Almaty';

/** Сколько календарных дней в зоне считать «ещё свежо» после «сегодня» (по умолчанию 7) */
function freshCalendarDaysAfterToday() {
  const n = parseInt(process.env.VISIT_FRESH_CALENDAR_DAYS || '7', 10);
  return Number.isFinite(n) && n >= 1 ? n : 7;
}

/**
 * Все строки, с которыми может совпадать checkins.fridgeId (как в GET /api/fridges).
 */
function buildCheckinFridgeIdCandidates(fridgeLike) {
  const out = [];
  const add = (v) => {
    if (v == null || String(v).trim() === '') return;
    const t = String(v).trim();
    const bare = t.replace(/^#+/, '');
    out.push(t);
    if (bare) {
      out.push(bare);
      out.push(`#${bare}`);
    }
  };
  add(fridgeLike.code);
  add(fridgeLike.number);
  if (fridgeLike.clientInfo?.inn) add(fridgeLike.clientInfo.inn);
  return [...new Set(out)];
}

function parseVisitTimeMs(lastVisit) {
  if (lastVisit == null) return null;
  if (lastVisit instanceof Date) {
    const t = lastVisit.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof lastVisit === 'string' || typeof lastVisit === 'number') {
    const t = new Date(lastVisit).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof lastVisit.getTime === 'function') {
    const t = lastVisit.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(lastVisit).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Календарные дни между датой визита и «сейчас» в указанной зоне (0 = тот же день).
 */
function calendarDaysFromVisitToNow(nowMs, visitMs, timeZone) {
  const ymd = (ms) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type) => {
      const x = parts.find((p) => p.type === type);
      return x ? parseInt(x.value, 10) : 0;
    };
    return { y: get('year'), m: get('month'), d: get('day') };
  };
  const a = ymd(visitMs);
  const b = ymd(nowMs);
  const ua = Date.UTC(a.y, a.m - 1, a.d);
  const ub = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((ub - ua) / 86400000);
}

/**
 * @param {Date|string|number|null} lastVisit
 * @param {{ nowMs?: number, timeZone?: string, freshDays?: number }} [opts]
 */
function visitStatusFromLastVisit(lastVisit, opts = {}) {
  const visitMs = parseVisitTimeMs(lastVisit);
  if (visitMs == null) return 'never';
  const timeZone = opts.timeZone || DEFAULT_VISIT_TIMEZONE;
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const freshDays = opts.freshDays != null ? opts.freshDays : freshCalendarDaysAfterToday();
  const d = calendarDaysFromVisitToNow(nowMs, visitMs, timeZone);
  if (d <= 0) return 'today';
  if (d <= freshDays) return 'week';
  return 'old';
}

/**
 * statsMap: ключ — точное значение checkins.fridgeId (после trim), значение — { lastVisit, totalCheckins? }
 */
function getLastVisitFromStatsMap(statsByFridgeId, fridgeLike) {
  const candidateIds = buildCheckinFridgeIdCandidates(fridgeLike);
  let lastVisit = null;
  let lastVisitTime = null;
  let totalCheckins = 0;
  for (const id of candidateIds) {
    const stats = statsByFridgeId.get(id);
    if (stats && stats.lastVisit) {
      const visitTime = parseVisitTimeMs(stats.lastVisit);
      if (visitTime != null && (!lastVisitTime || visitTime > lastVisitTime)) {
        lastVisitTime = visitTime;
        lastVisit = stats.lastVisit;
      }
      totalCheckins += stats.totalCheckins || 0;
    }
  }
  return { lastVisit, lastVisitTime, totalCheckins };
}

module.exports = {
  buildCheckinFridgeIdCandidates,
  visitStatusFromLastVisit,
  getLastVisitFromStatsMap,
  parseVisitTimeMs,
  calendarDaysFromVisitToNow,
  DEFAULT_VISIT_TIMEZONE,
  freshCalendarDaysAfterToday,
};
