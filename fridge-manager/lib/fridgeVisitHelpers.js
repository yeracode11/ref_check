/**
 * Единая логика: какие строки checkins.fridgeId относятся к холодильнику,
 * и как по дате визита получить today / week / old (для карты и отчётов).
 */

const { bareFridgeId, legacyNumericFridgeIdVariant } = require('./fridgeIdFormat');

const DEFAULT_VISIT_TIMEZONE = 'Asia/Almaty';

/** Сколько календарных дней в зоне считать «ещё свежо» после «сегодня» (по умолчанию 7) */
function freshCalendarDaysAfterToday() {
  const n = parseInt(process.env.VISIT_FRESH_CALENDAR_DAYS || '7', 10);
  return Number.isFinite(n) && n >= 1 ? n : 7;
}

/** Режимные объекты посещают раз в 1–2 месяца — не считаем просрочкой раньше этого срока */
function restrictedVisitGraceDays() {
  const n = parseInt(process.env.RESTRICTED_VISIT_GRACE_DAYS || '60', 10);
  return Number.isFinite(n) && n >= 14 ? n : 60;
}

function isRestrictedObject(fridgeLike) {
  return fridgeLike?.type === 'restricted';
}

function isObjectOnSeasonalClosure(fridgeLike) {
  return fridgeLike?.isSeasonalClosure === true;
}

function supportsSeasonalClosureFlag(fridgeLike) {
  const type = fridgeLike?.type;
  return type === 'school' || type === 'restricted';
}

function freshDaysForFridgeType(fridgeType) {
  return fridgeType === 'restricted' ? restrictedVisitGraceDays() : freshCalendarDaysAfterToday();
}

/**
 * Показывать в таблице «давно без отметок».
 * Режимный объект не попадает, пока с последней отметки не прошло больше grace-дней.
 */
function shouldIncludeInUnvisitedReport(fridgeLike, { lastVisit, daysSinceVisit } = {}) {
  if (isObjectOnSeasonalClosure(fridgeLike)) return false;
  if (!isRestrictedObject(fridgeLike)) return true;
  if (!lastVisit) return false;
  const grace = restrictedVisitGraceDays();
  return daysSinceVisit != null && daysSinceVisit > grace;
}

function shouldCountAsWithoutCheckinsInPeriod(fridgeLike, visitedInPeriod) {
  if (isObjectOnSeasonalClosure(fridgeLike) || isRestrictedObject(fridgeLike)) return false;
  return !visitedInPeriod;
}

function shouldCountAsNeverVisited(fridgeLike, lastVisit) {
  if (isObjectOnSeasonalClosure(fridgeLike) || isRestrictedObject(fridgeLike)) return false;
  return !lastVisit;
}

function visitStatusDisplayLabel(mapSt) {
  if (mapSt === 'seasonal_closure') return 'Каникулы';
  if (mapSt === 'never') return 'Нет отметок';
  if (mapSt === 'old') return 'Давно';
  if (mapSt === 'today') return 'Сегодня';
  if (mapSt === 'week') return 'Неделя';
  return mapSt || '';
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

/**
 * Расширяет список идентификаторов для $in: в checkins.fridgeId часто число, не строка.
 */
function expandCheckinFridgeIdsForInQuery(ids) {
  const expanded = new Set();
  for (const id of ids) {
    if (id == null || String(id).trim() === '') continue;
    const t = String(id).trim();
    const bare = t.replace(/^#+/, '');
    expanded.add(t);
    if (bare) {
      expanded.add(bare);
      expanded.add(`#${bare}`);
      const numeric = legacyNumericFridgeIdVariant(bare);
      if (numeric != null) {
        expanded.add(numeric);
      }
    }
  }
  return [...expanded];
}

/**
 * Условие для find/$match: в MongoDB fridgeId в чекинах может быть строкой или числом (старые данные).
 * Только строковый $in не находит документы с числовым fridgeId — из‑за этого lastVisit в деталях
 * мог отличаться от агрегата на /fridge-status (другая «последняя» отметка → другой цвет маркера).
 */
function buildDailyCheckinsAggregationStages(matchFilter, timezone = DEFAULT_VISIT_TIMEZONE) {
  return [
    { $match: matchFilter },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$visitedAt',
            timezone,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ];
}

function mapDailyCheckinsAggregationResult(rows) {
  return rows.map((item) => ({
    date: item._id,
    count: item.count,
  }));
}

/** Ключ YYYY-MM-DD в локальной зоне (для JS-агрегации без Mongo $dateToString). */
function localDateKeyFromVisit(visitedAt, timezone = DEFAULT_VISIT_TIMEZONE) {
  const d = visitedAt instanceof Date ? visitedAt : new Date(visitedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: timezone });
}

function buildCheckinFridgeIdMatchCondition(fridgeLike) {
  const candidates = buildCheckinFridgeIdCandidates(fridgeLike);
  const or = [];
  for (const id of candidates) {
    or.push({ fridgeId: id });
    const numeric = legacyNumericFridgeIdVariant(bareFridgeId(id));
    if (numeric != null) {
      or.push({ fridgeId: numeric });
    }
  }
  return or.length ? { $or: or } : null;
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
  const freshDays = opts.freshDays != null
    ? opts.freshDays
    : freshDaysForFridgeType(opts.fridgeType);
  const d = calendarDaysFromVisitToNow(nowMs, visitMs, timeZone);
  if (d <= 0) return 'today';
  if (d <= freshDays) return 'week';
  return 'old';
}

function isWarehouseHiddenAtDepot(warehouseStatus, locationAtDepot) {
  const ws = warehouseStatus || 'warehouse';
  if (ws !== 'warehouse') return false;
  return locationAtDepot !== false;
}

/**
 * Итоговый статус отметки для карты, списка и Excel — как поле status в GET /admin/fridge-status.
 * При возврате на склад и «на складе» без отметки на карте не показываем давность старых чекинов.
 */
function combinedVisitMapStatus(lastVisit, warehouseStatus, opts = {}) {
  if (opts.isSeasonalClosure === true) {
    return 'seasonal_closure';
  }

  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const ws = warehouseStatus || 'warehouse';
  const visitTimeliness = visitStatusFromLastVisit(lastVisit, {
    nowMs,
    fridgeType: opts.fridgeType,
    freshDays: opts.freshDays,
  });

  if (!lastVisit) {
    return 'never';
  }
  if (ws === 'returned') {
    return 'never';
  }
  if (isWarehouseHiddenAtDepot(ws, opts.locationAtDepot)) {
    return 'never';
  }
  return visitTimeliness;
}

/**
 * Сводка по городу: свежие/старые/на складе (по отметкам) и статусы склада.
 * Та же логика, что в GET /admin/statistics/by-cities и аналитике бухгалтера/НОП.
 */
function computeCityFridgeStatsCounts(fridges, statsByFridgeId, nowMs = Date.now()) {
  const counts = {
    total: 0,
    fresh: 0,
    old: 0,
    never: 0,
    warehouse: 0,
    installed: 0,
    returned: 0,
    moved: 0,
  };

  if (!Array.isArray(fridges)) return counts;

  fridges.forEach((f) => {
    counts.total++;
    const { lastVisit } = getLastVisitFromStatsMap(statsByFridgeId, f);
    const warehouseStatus = f.warehouseStatus || 'warehouse';

    const mapStatus = combinedVisitMapStatus(lastVisit, warehouseStatus, {
      nowMs,
      fridgeType: f.type,
      locationAtDepot: f.locationAtDepot,
      isSeasonalClosure: f.isSeasonalClosure,
    });

    if (mapStatus === 'seasonal_closure') {
      // Временно закрытые объекты не попадают в fresh/old/never
    } else if (mapStatus === 'never') {
      counts.never++;
    } else if (mapStatus === 'today' || mapStatus === 'week') {
      counts.fresh++;
    } else {
      counts.old++;
    }

    if (warehouseStatus === 'warehouse') {
      counts.warehouse++;
    } else if (warehouseStatus === 'installed') {
      counts.installed++;
    } else if (warehouseStatus === 'returned') {
      counts.returned++;
    } else if (warehouseStatus === 'moved') {
      counts.moved++;
    }
  });

  return counts;
}

/**
 * Сливает строки $group по fridgeId в одну Map по нормализованному ключу.
 * В MongoDB у части чекинов fridgeId строка "1133", у части — число 1133: это две группы агрегации,
 * но String(_id) совпадает — без слияния по max(lastVisit) остаётся случайная дата (часто старая).
 *
 * @param {Array<{ _id: unknown, lastVisit?: Date, totalCheckins?: number }>} rows
 * @returns {Map<string, { lastVisit: Date|null, lastFridgeCondition?: string|null, totalCheckins: number }>}
 */
function mergeCheckinStatsAggregationIntoMap(rows) {
  const statsByFridgeId = new Map();
  if (!Array.isArray(rows)) return statsByFridgeId;

  for (const s of rows) {
    if (!s || s._id == null || s._id === '') continue;
    const key = String(s._id).trim();
    if (!key) continue;

    const visitMs = parseVisitTimeMs(s.lastVisit);
    const addCount = Number(s.totalCheckins) || 0;
    const existing = statsByFridgeId.get(key);

    if (!existing) {
      statsByFridgeId.set(key, {
        lastVisit: s.lastVisit ?? null,
        lastFridgeCondition: s.lastFridgeCondition ?? null,
        totalCheckins: addCount,
      });
      continue;
    }

    const exMs = parseVisitTimeMs(existing.lastVisit);
    let nextVisit = existing.lastVisit;
    let nextCondition = existing.lastFridgeCondition ?? null;
    if (visitMs != null && (exMs == null || visitMs > exMs)) {
      nextVisit = s.lastVisit;
      nextCondition = s.lastFridgeCondition ?? null;
    }
    statsByFridgeId.set(key, {
      lastVisit: nextVisit,
      lastFridgeCondition: nextCondition,
      totalCheckins: (existing.totalCheckins || 0) + addCount,
    });
  }

  return statsByFridgeId;
}

/**
 * statsMap: ключ — String(Fridge._id); значение — { lastVisit, totalCheckins?, ... }
 */
function getLastVisitFromStatsMap(statsByFridgeId, fridgeLike) {
  if (fridgeLike?._id != null) {
    const byDoc = statsByFridgeId.get(String(fridgeLike._id));
    return {
      lastVisit: byDoc?.lastVisit ?? null,
      lastVisitTime: parseVisitTimeMs(byDoc?.lastVisit),
      lastFridgeCondition: byDoc?.lastFridgeCondition ?? null,
      totalCheckins: byDoc?.totalCheckins || 0,
    };
  }

  const candidateIds = buildCheckinFridgeIdCandidates(fridgeLike);
  let lastVisit = null;
  let lastVisitTime = null;
  let lastFridgeCondition = null;
  let totalCheckins = 0;
  for (const id of candidateIds) {
    const stats = statsByFridgeId.get(id);
    if (stats && stats.lastVisit) {
      const visitTime = parseVisitTimeMs(stats.lastVisit);
      if (visitTime != null && (!lastVisitTime || visitTime > lastVisitTime)) {
        lastVisitTime = visitTime;
        lastVisit = stats.lastVisit;
        lastFridgeCondition = stats.lastFridgeCondition ?? null;
      }
      totalCheckins += stats.totalCheckins || 0;
    }
  }
  return { lastVisit, lastVisitTime, lastFridgeCondition, totalCheckins };
}

/**
 * Состояние оборудования для карты: приоритет — поле Fridge.status,
 * запасной вариант — последняя отметка ТП (если в БД ещё не синхронизировали).
 */
function resolveEquipmentStatus(fridgeStatus, lastFridgeCondition) {
  const status = fridgeStatus || 'working';
  if (status === 'under_repair' || status === 'broken') return status;
  if (lastFridgeCondition === 'broken') return 'broken';
  return status;
}

function formatVisitDateTimeRu(value, timeZone = DEFAULT_VISIT_TIMEZONE) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

module.exports = {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  buildCheckinFridgeIdMatchCondition,
  buildDailyCheckinsAggregationStages,
  mapDailyCheckinsAggregationResult,
  localDateKeyFromVisit,
  visitStatusFromLastVisit,
  combinedVisitMapStatus,
  mergeCheckinStatsAggregationIntoMap,
  getLastVisitFromStatsMap,
  resolveEquipmentStatus,
  parseVisitTimeMs,
  calendarDaysFromVisitToNow,
  DEFAULT_VISIT_TIMEZONE,
  freshCalendarDaysAfterToday,
  restrictedVisitGraceDays,
  isRestrictedObject,
  isObjectOnSeasonalClosure,
  supportsSeasonalClosureFlag,
  freshDaysForFridgeType,
  shouldIncludeInUnvisitedReport,
  shouldCountAsWithoutCheckinsInPeriod,
  shouldCountAsNeverVisited,
  visitStatusDisplayLabel,
  computeCityFridgeStatsCounts,
  formatVisitDateTimeRu,
};
