const {
  getLastVisitFromStatsMap,
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  shouldIncludeInUnvisitedReport,
  combinedVisitMapStatus,
  calendarDaysFromVisitToNow,
  parseVisitTimeMs,
  DEFAULT_VISIT_TIMEZONE,
  formatVisitDateTimeRu,
  visitStatusDisplayLabel,
} = require('./fridgeVisitHelpers');

const FRIDGE_TYPE_LABELS = {
  regular: 'Обычный',
  school: 'Школа',
  restricted: 'Режимный',
};

const EQUIPMENT_LABELS = {
  working: 'Исправен',
  broken: 'Сломан',
  under_repair: 'На ремонте',
};

function formatExportDateTime(value) {
  return formatVisitDateTimeRu(value);
}

function visitStatusLabel(mapSt) {
  return visitStatusDisplayLabel(mapSt);
}

function buildCheckinIdListFromFridges(fridges) {
  const ids = new Set();
  for (const fridge of fridges) {
    for (const id of buildCheckinFridgeIdCandidates(fridge)) {
      ids.add(id);
    }
  }
  return expandCheckinFridgeIdsForInQuery([...ids]);
}

/** Фильтр отметок за период с учётом fridgeRef (не только legacy fridgeId) */
async function buildAnalyticsPeriodMatch(cityId, startDate) {
  const match = { visitedAt: { $gte: startDate } };
  if (cityId && cityId !== 'all') {
    const { getCheckinFilterForCity } = require('./cityScope');
    Object.assign(match, await getCheckinFilterForCity(cityId));
  }
  return match;
}

function buildTopUnvisitedFromFridges(fridges, statsByFridgeId, limit = 20) {
  const rows = fridges.map((f) => {
    const { lastVisit } = getLastVisitFromStatsMap(statsByFridgeId, f);
    const lastVisitDate = lastVisit ? new Date(lastVisit) : null;

    let cityId = null;
    if (f.cityId) {
      if (typeof f.cityId === 'object' && f.cityId.name) {
        cityId = { name: f.cityId.name, code: f.cityId.code };
      } else {
        cityId = f.cityId;
      }
    }

    return {
      code: f.code,
      number: f.number,
      name: f.name,
      address: f.address,
      cityId,
      type: f.type || 'regular',
      isSeasonalClosure: f.isSeasonalClosure,
      lastVisit,
      daysSinceVisit: lastVisitDate
        ? Math.floor((Date.now() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };
  });

  return rows
    .filter((row) => shouldIncludeInUnvisitedReport(
      { type: row.type, isSeasonalClosure: row.isSeasonalClosure },
      { lastVisit: row.lastVisit, daysSinceVisit: row.daysSinceVisit },
    ))
    .sort((a, b) => {
      if (a.lastVisit === null && b.lastVisit === null) return 0;
      if (a.lastVisit === null) return -1;
      if (b.lastVisit === null) return 1;
      return new Date(a.lastVisit).getTime() - new Date(b.lastVisit).getTime();
    })
    .slice(0, limit);
}

function buildVisitStatusExportRow(f, statsByFridgeId, nowMs, mapSt, lastManagerDisplayByFridgeId) {
  const { lastVisit, totalCheckins } = getLastVisitFromStatsMap(statsByFridgeId, f);
  const visitMs = parseVisitTimeMs(lastVisit);
  const daysSinceVisit = visitMs != null
    ? calendarDaysFromVisitToNow(nowMs, visitMs, DEFAULT_VISIT_TIMEZONE)
    : null;
  const statusKey = f.status || 'working';
  const tpLabel = lastManagerDisplayByFridgeId?.get(String(f._id)) || '';

  return {
    'ID Холодильника': f.number || f.code || String(f._id),
    'Город': f.cityId?.name || '',
    'Название': f.name || '',
    'Адрес': f.address || '',
    'Тип объекта': FRIDGE_TYPE_LABELS[f.type] || FRIDGE_TYPE_LABELS.regular,
    'Статус визита': visitStatusLabel(mapSt),
    'Последний визит': lastVisit ? formatExportDateTime(lastVisit) : '',
    'ТП последней отметки': tpLabel,
    'Дней без визита': daysSinceVisit != null ? daysSinceVisit : '',
    'Всего отметок': totalCheckins || 0,
    'Статус ХО': EQUIPMENT_LABELS[statusKey] || statusKey,
    _fridgeId: f._id,
  };
}

function sortProblemVisitRows(rows) {
  return [...rows].sort((a, b) => {
    const aNever = !a['Последний визит'];
    const bNever = !b['Последний визит'];
    if (aNever && !bNever) return -1;
    if (!aNever && bNever) return 1;
    const ad = Number(a['Дней без визита']) || 0;
    const bd = Number(b['Дней без визита']) || 0;
    return bd - ad;
  });
}

function sortFreshVisitRows(rows) {
  return [...rows].sort((a, b) => {
    const ad = Number(a['Дней без визита']) || 0;
    const bd = Number(b['Дней без визита']) || 0;
    return ad - bd;
  });
}

/**
 * Листы визитов для Excel: нет отметок / давно / сегодня+неделя + id всего охвата (кроме склада).
 */
function buildVisitCategoryExportRows(fridges, statsByFridgeId, nowMs = Date.now(), lastManagerDisplayByFridgeId) {
  const neverRows = [];
  const oldRows = [];
  const freshRows = [];
  const scopeFridgeIds = [];

  for (const f of fridges) {
    if (f.warehouseStatus === 'warehouse') continue;

    scopeFridgeIds.push(f._id);

    const { lastVisit } = getLastVisitFromStatsMap(statsByFridgeId, f);
    const mapSt = combinedVisitMapStatus(lastVisit, f.warehouseStatus, {
      nowMs,
      fridgeType: f.type,
      locationAtDepot: f.locationAtDepot,
      isSeasonalClosure: f.isSeasonalClosure,
    });

    if (mapSt === 'seasonal_closure') {
      continue;
    }

    const visitMs = parseVisitTimeMs(lastVisit);
    const daysSinceVisit = visitMs != null
      ? calendarDaysFromVisitToNow(nowMs, visitMs, DEFAULT_VISIT_TIMEZONE)
      : null;

    if (mapSt === 'never') {
      neverRows.push(buildVisitStatusExportRow(
        f, statsByFridgeId, nowMs, mapSt, lastManagerDisplayByFridgeId,
      ));
      continue;
    }

    if (mapSt === 'old') {
      if (!shouldIncludeInUnvisitedReport(f, { lastVisit, daysSinceVisit })) continue;
      oldRows.push(buildVisitStatusExportRow(
        f, statsByFridgeId, nowMs, mapSt, lastManagerDisplayByFridgeId,
      ));
      continue;
    }

    if (mapSt === 'today' || mapSt === 'week') {
      freshRows.push(buildVisitStatusExportRow(
        f, statsByFridgeId, nowMs, mapSt, lastManagerDisplayByFridgeId,
      ));
    }
  }

  return {
    neverRows: sortProblemVisitRows(neverRows),
    oldRows: sortProblemVisitRows(oldRows),
    freshRows: sortFreshVisitRows(freshRows),
    scopeFridgeIds,
  };
}

/** @deprecated используйте buildVisitCategoryExportRows */
function buildUnvisitedExportRows(fridges, statsByFridgeId, nowMs = Date.now()) {
  const { neverRows, oldRows, scopeFridgeIds } = buildVisitCategoryExportRows(
    fridges,
    statsByFridgeId,
    nowMs,
  );
  const rows = sortProblemVisitRows([...neverRows, ...oldRows]);
  return { rows, fridgeIds: scopeFridgeIds };
}

module.exports = {
  buildCheckinIdListFromFridges,
  buildAnalyticsPeriodMatch,
  buildTopUnvisitedFromFridges,
  buildVisitCategoryExportRows,
  buildUnvisitedExportRows,
  visitStatusLabel,
};
