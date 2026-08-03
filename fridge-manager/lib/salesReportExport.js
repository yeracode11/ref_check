const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const Repair = require('../models/Repair');
const XLSX = require('xlsx');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  getLastVisitFromStatsMap,
  combinedVisitMapStatus,
} = require('./fridgeVisitHelpers');
const { getCheckinStatsForFridges } = require('./checkinStatsCache');
const { resolveCityFilter } = require('./cityScope');
const { buildVisitCategoryExportRows } = require('./analyticsHelpers');
const { buildCaseInsensitiveRegex } = require('./stringHelpers');
const {
  fetchFridgeListSheetRows,
  appendFridgeListSheet,
  buildFridgesExportFileName,
} = require('./fridgeExcelExport');
const { labelsFromCompletedWorks } = require('./mxoRepairWorks');
const { isComplexRepairRecord } = require('./repairHelpers');

const FRIDGE_TYPE_LABELS = {
  regular: 'Обычный',
  school: 'Школа',
  restricted: 'Режимный',
};

const EQUIPMENT_STATUS_LABELS = {
  working: 'Исправен (working)',
  broken: 'Сломан (broken)',
  under_repair: 'На ремонте (under_repair)',
};

/** Максимум строк на листе «История ремонтов» (весь охват отчёта). */
const REPAIR_EXPORT_MAX_ROWS = parseInt(process.env.EXPORT_REPAIR_MAX_ROWS || '5000', 10);
/** Последние отметки ТП на листе «Отметки ТП» (не вся история). */
const CHECKIN_SUMMARY_MAX_ROWS = parseInt(process.env.EXPORT_CHECKIN_MAX_ROWS || '5000', 10);
const CHECKIN_SUMMARY_SELECT =
  'visitedAt fridgeId fridgeRef managerId fridgeCondition isSeasonalClosure notes address';

function getFridgeDisplayId(fridge) {
  return fridge.number || fridge.code || String(fridge._id);
}

function buildEquipmentStatusFilter(equipmentStatus) {
  if (!equipmentStatus || equipmentStatus === 'all') return null;
  if (equipmentStatus === 'faulty') {
    return { $in: ['broken', 'under_repair'] };
  }
  if (['working', 'broken', 'under_repair'].includes(equipmentStatus)) {
    return equipmentStatus;
  }
  return null;
}

function buildFridgeQuery(user, query = {}, opts = {}) {
  const { cityId, equipmentStatus, search } = query;
  const filter = {};
  if (opts.activeOnly !== false) {
    filter.active = true;
  }

  const scopedCityId = resolveCityFilter(user, cityId);
  if (scopedCityId) {
    filter.cityId = scopedCityId;
  }

  const statusFilter = buildEquipmentStatusFilter(equipmentStatus);
  if (statusFilter) {
    filter.status = statusFilter;
  }

  if (search && String(search).trim()) {
    const searchRegex = buildCaseInsensitiveRegex(search);
    if (searchRegex) {
      filter.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { number: searchRegex },
        { address: searchRegex },
      ];
    }
  }

  return filter;
}

function filterFridgesExcludingFreshVisits(fridges, statsByFridgeId, nowMs = Date.now()) {
  return fridges.filter((f) => {
    const { lastVisit } = getLastVisitFromStatsMap(statsByFridgeId, f);
    const mapSt = combinedVisitMapStatus(lastVisit, f.warehouseStatus, {
      nowMs,
      fridgeType: f.type,
    });
    return mapSt !== 'today' && mapSt !== 'week';
  });
}

async function countBrokenCheckinsByFridge(fridges, checkinIdList) {
  const fridgeObjectIds = fridges.map((f) => f._id).filter(Boolean);
  const result = new Map();
  if (!fridgeObjectIds.length) return result;

  const chunkSize = 8000;
  for (let i = 0; i < fridgeObjectIds.length; i += chunkSize) {
    const chunk = fridgeObjectIds.slice(i, i + chunkSize);
    const rows = await Checkin.aggregate([
      { $match: { fridgeCondition: 'broken', fridgeRef: { $in: chunk } } },
      { $group: { _id: '$fridgeRef', n: { $sum: 1 } } },
    ]);
    for (const row of rows) {
      if (row._id == null) continue;
      const key = String(row._id);
      result.set(key, (result.get(key) || 0) + row.n);
    }
  }

  // Legacy отметки без fridgeRef (редко после backfill)
  const skipLegacy = process.env.EXPORT_SKIP_LEGACY_BROKEN !== 'false';
  const expandedIds = expandCheckinFridgeIdsForInQuery(checkinIdList);
  if (!skipLegacy && expandedIds.length) {
    const legacyRows = await Checkin.find({
      fridgeCondition: 'broken',
      $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }],
      fridgeId: { $in: expandedIds.slice(0, 5000) },
    })
      .select('fridgeId')
      .limit(50000)
      .lean();

    const fridgeByCheckinId = new Map();
    for (const fridge of fridges) {
      const fridgeKey = String(fridge._id);
      for (const id of buildCheckinFridgeIdCandidates(fridge)) {
        fridgeByCheckinId.set(String(id).trim(), fridgeKey);
        const n = Number(id);
        if (Number.isFinite(n)) fridgeByCheckinId.set(String(n), fridgeKey);
      }
    }
    for (const row of legacyRows) {
      const fridgeKey = fridgeByCheckinId.get(String(row.fridgeId).trim());
      if (!fridgeKey) continue;
      result.set(fridgeKey, (result.get(fridgeKey) || 0) + 1);
    }
  }

  return result;
}

async function loadFullExportContext(user, query, opts = {}) {
  const fridgeFilter = buildFridgeQuery(user, query, opts);
  const fridges = await Fridge.find(fridgeFilter).populate('cityId', 'name code').lean();

  const checkinIdSet = new Set();
  fridges.forEach((f) => {
    buildCheckinFridgeIdCandidates(f).forEach((id) => checkinIdSet.add(id));
  });
  const checkinIdList = [...checkinIdSet];

  const statsPayload = fridges.map((f) => ({
    _id: f._id,
    code: f.code,
    number: f.number,
    clientInfo: f.clientInfo,
    type: f.type,
  }));

  const [statsByFridgeId, brokenByFridgeId] = await Promise.all([
    getCheckinStatsForFridges(
      statsPayload,
      JSON.stringify({ export: 'full', ...fridgeFilter }),
      { useCache: true },
    ),
    countBrokenCheckinsByFridge(fridges, checkinIdList),
  ]);

  return { fridges, statsByFridgeId, brokenByFridgeId, fridgeFilter };
}

/**
 * Лист 1: состояние фонда холодильников региона НОП.
 */
async function fetchFundSheetRows(user, query, opts = {}, exportContext = null) {
  let fridges;
  let statsByFridgeId;
  let brokenByFridgeId;

  if (exportContext) {
    ({ fridges, statsByFridgeId, brokenByFridgeId } = exportContext);
    if (opts.excludeFreshVisits) {
      fridges = filterFridgesExcludingFreshVisits(fridges, statsByFridgeId);
    }
  } else {
    const fridgeFilter = buildFridgeQuery(user, query, opts);
    fridges = await Fridge.find(fridgeFilter)
      .populate('cityId', 'name code')
      .sort({ createdAt: -1 })
      .lean();
    const cacheScopeKey = JSON.stringify({ ...fridgeFilter, export: 'sales-fund' });
    statsByFridgeId = await getCheckinStatsForFridges(fridges, cacheScopeKey, { useCache: true });
    const checkinIdSet = new Set();
    fridges.forEach((f) => {
      buildCheckinFridgeIdCandidates(f).forEach((id) => checkinIdSet.add(id));
    });
    brokenByFridgeId = await countBrokenCheckinsByFridge(fridges, [...checkinIdSet]);
  }

  return fridges.map((f) => {
    const { totalCheckins } = getLastVisitFromStatsMap(statsByFridgeId, f);
    const statusKey = f.status || 'working';
    return {
      'ID Холодильника': getFridgeDisplayId(f),
      'Город': f.cityId?.name || '',
      'Адрес торговой точки': f.address || '',
      'Тип объекта': FRIDGE_TYPE_LABELS[f.type] || FRIDGE_TYPE_LABELS.regular,
      'Текущий статус': EQUIPMENT_STATUS_LABELS[statusKey] || statusKey,
      'Объект закрыт на каникулы': f.isSeasonalClosure ? 'Да' : 'Нет',
      'Общее кол-во чекинов': totalCheckins || 0,
      'Кол-во поломок за всё время': brokenByFridgeId.get(String(f._id)) || 0,
    };
  });
}

/**
 * Лист: ремонты МХО по всем холодильникам в охвате отчёта (админ / бухгалтер — свой город).
 */
async function fetchRepairSheetRows(user, query, opts = {}, repairScope = {}) {
  let fridgeIds = repairScope.fridgeIds;
  const maxRows = repairScope.maxRows ?? REPAIR_EXPORT_MAX_ROWS;

  if (!fridgeIds?.length) {
    const fridgeFilter = buildFridgeQuery(user, query, opts);
    fridgeIds = await Fridge.find(fridgeFilter).distinct('_id');
  }

  if (!fridgeIds.length) return [];

  const repairDocs = await Repair.find({ fridgeId: { $in: fridgeIds } })
    .sort({ repairDate: -1 })
    .limit(Math.max(1, maxRows))
    .populate('fridgeId', 'code number address')
    .populate('technicianId', 'fullName username')
    .lean();

  return repairDocs.map((r) => {
    const fridge = r.fridgeId;
    const technician = r.technicianId;
    const workLabels = labelsFromCompletedWorks(r.completedWorks);
    const partsList = workLabels.length
      ? workLabels.join(', ')
      : (Array.isArray(r.replacedParts) ? r.replacedParts.join(', ') : '');
    const complex = isComplexRepairRecord(r);

    return {
      'Дата ремонта': r.repairDate ? new Date(r.repairDate).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Almaty',
      }) : '',
      'ID Холодильника': fridge && typeof fridge === 'object'
        ? getFridgeDisplayId(fridge)
        : String(r.fridgeId),
      'Адрес точки': (fridge && typeof fridge === 'object' ? fridge.address : '') || '',
      'Вид выполненных работ': r.workType || '',
      'Перечень замененных деталей': partsList,
      'Ответственный сотрудник МХО': technician && typeof technician === 'object'
        ? (technician.fullName || technician.username || '')
        : '',
      'Комментарий МХО': r.comment || '',
      'Сложный ремонт': complex ? 'Да' : 'Нет',
      _isComplexRepair: complex,
    };
  });
}

function fetchVisitCategorySheets(exportContext, nowMs = Date.now()) {
  if (!exportContext?.fridges?.length) {
    return {
      neverRows: [],
      oldRows: [],
      freshRows: [],
      scopeFridgeIds: exportContext?.fridges?.map((f) => f._id) || [],
    };
  }
  return buildVisitCategoryExportRows(
    exportContext.fridges,
    exportContext.statsByFridgeId,
    nowMs,
  );
}

async function fetchCheckinSummarySheetRows(fridges, limit = CHECKIN_SUMMARY_MAX_ROWS) {
  if (!fridges?.length) return [];

  const fridgeObjectIds = fridges.map((f) => f._id).filter(Boolean);
  const fridgeByRef = new Map();
  const fridgeByCheckinId = new Map();
  fridges.forEach((f) => {
    fridgeByRef.set(String(f._id), f);
    for (const id of buildCheckinFridgeIdCandidates(f)) {
      fridgeByCheckinId.set(String(id).trim(), f);
      const n = Number(id);
      if (Number.isFinite(n)) fridgeByCheckinId.set(String(n), f);
    }
  });

  const checkins = await Checkin.find({ fridgeRef: { $in: fridgeObjectIds } })
    .sort({ visitedAt: -1 })
    .limit(Math.max(1, limit))
    .select(CHECKIN_SUMMARY_SELECT)
    .lean();

  const User = require('../models/User');
  const managerIds = [...new Set(checkins.map((c) => c.managerId).filter(Boolean))];
  const users = managerIds.length
    ? await User.find({
      $or: [
        { username: { $in: managerIds } },
        { _id: { $in: managerIds.filter((id) => /^[a-fA-F0-9]{24}$/.test(String(id))) } },
      ],
    }).select('username fullName').lean()
    : [];
  const userMap = new Map();
  users.forEach((u) => {
    if (u.username) userMap.set(u.username, u);
    userMap.set(String(u._id), u);
  });

  return checkins.map((c) => {
    const fridge =
      (c.fridgeRef && fridgeByRef.get(String(c.fridgeRef))) ||
      fridgeByCheckinId.get(String(c.fridgeId).trim());
    const manager = userMap.get(c.managerId) || userMap.get(String(c.managerId));
    return {
      'Дата отметки': c.visitedAt ? new Date(c.visitedAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Almaty',
      }) : '',
      'ID Холодильника': fridge ? getFridgeDisplayId(fridge) : c.fridgeId,
      'Город': fridge?.cityId?.name || '',
      'Название точки': fridge?.name || '',
      'Адрес точки': fridge?.address || c.address || '',
      'Сотрудник ТП': manager?.fullName || manager?.username || c.managerId || '',
      'Состояние': c.fridgeCondition === 'broken' ? 'Сломан' : 'Рабочий',
      'Закрыт на каникулы': c.isSeasonalClosure ? 'Да' : 'Нет',
      'Комментарий': c.notes || '',
    };
  });
}

function stripInternalExportFields(rows) {
  return rows.map(({ _fridgeId, ...row }) => row);
}

function applyComplexRepairRowMark(worksheet, rowCount, colCount) {
  // xlsx community edition не сохраняет заливку; помечаем строку через колонку «Сложный ремонт»
  if (!worksheet || rowCount < 2) return;
  for (let r = 2; r <= rowCount; r += 1) {
    const flagCell = worksheet[XLSX.utils.encode_cell({ r: r - 1, c: colCount - 1 })];
    if (flagCell && flagCell.v === 'Да') {
      for (let c = 0; c < colCount; c += 1) {
        const addr = XLSX.utils.encode_cell({ r: r - 1, c });
        if (worksheet[addr]) {
          worksheet[addr].s = {
            fill: { patternType: 'solid', fgColor: { rgb: 'FFFFE0CC' } },
          };
        }
      }
    }
  }
}

function appendVisitStatusSheet(workbook, sheetName, rows, columnWidths) {
  const forSheet = stripInternalExportFields(rows);
  const sheet = XLSX.utils.json_to_sheet(
    forSheet.length ? forSheet : [{
      'ID Холодильника': '',
      'Город': '',
      'Название': '',
      'Адрес': '',
      'Тип объекта': '',
      'Статус визита': '',
      'Последний визит': '',
      'Дней без визита': '',
      'Всего отметок': '',
      'Статус ХО': '',
    }],
  );
  sheet['!cols'] = columnWidths;
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

const VISIT_SHEET_COLS = [
  { wch: 18 }, { wch: 14 }, { wch: 28 }, { wch: 40 }, { wch: 14 },
  { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 18 },
];

function isAccountantExport(user, opts = {}) {
  if (opts.accountantExport != null) return opts.accountantExport;
  return user?.role === 'accountant';
}

function appendFundAndRepairSheets(workbook, sheets) {
  const {
    fundRows,
    repairRows,
    neverRows,
    oldRows,
    freshRows,
  } = sheets;

  const fundSheet = XLSX.utils.json_to_sheet(fundRows);
  fundSheet['!cols'] = [
    { wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 28 },
    { wch: 14 }, { wch: 18 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, fundSheet, 'Состояние фонда');

  if (freshRows) {
    appendVisitStatusSheet(workbook, 'Сегодня и неделя', freshRows, VISIT_SHEET_COLS);
  }

  appendVisitStatusSheet(workbook, 'Нет отметок', neverRows, VISIT_SHEET_COLS);
  appendVisitStatusSheet(workbook, 'Давно', oldRows, VISIT_SHEET_COLS);

  const repairForSheet = repairRows.map(({ _isComplexRepair, ...row }) => row);
  const repairSheet = XLSX.utils.json_to_sheet(repairForSheet);
  const repairColCount = repairForSheet.length
    ? Object.keys(repairForSheet[0]).length
    : 8;
  repairSheet['!cols'] = [
    { wch: 20 }, { wch: 18 }, { wch: 40 }, { wch: 36 }, { wch: 42 },
    { wch: 28 }, { wch: 30 }, { wch: 16 },
  ];
  applyComplexRepairRowMark(repairSheet, repairForSheet.length + 1, repairColCount);
  XLSX.utils.book_append_sheet(workbook, repairSheet, 'История ремонтов');
}

function buildSalesReportWorkbook(reportSheets, fridgeRows = null) {
  const workbook = XLSX.utils.book_new();
  if (fridgeRows) {
    appendFridgeListSheet(workbook, fridgeRows);
  }
  appendFundAndRepairSheets(workbook, reportSheets);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function buildExportReportSheets(user, query, exportContext, exportOpts) {
  const visitCategories = fetchVisitCategorySheets(exportContext);
  const fridgeIdsForRepairs = exportContext.fridges.map((f) => f._id);
  const excludeFreshVisits = exportOpts.excludeFreshVisits
    ?? !isAccountantExport(user, exportOpts);

  const [fundRows, repairRows] = await Promise.all([
    fetchFundSheetRows(user, query, { ...exportOpts, excludeFreshVisits }, exportContext),
    fetchRepairSheetRows(user, query, exportOpts, { fridgeIds: fridgeIdsForRepairs }),
  ]);

  const reportSheets = {
    fundRows,
    repairRows,
    neverRows: visitCategories.neverRows,
    oldRows: visitCategories.oldRows,
  };

  if (exportOpts.includeFreshVisitSheets ?? isAccountantExport(user, exportOpts)) {
    reportSheets.freshRows = visitCategories.freshRows;
  }

  return reportSheets;
}

/**
 * Добавляет листы НОП (состояние фонда + ремонты МХО) в существующую книгу Excel.
 * Для админского экспорта: activeOnly=false — тот же охват, что и лист «Холодильники».
 */
async function appendSalesReportSheets(workbook, user, query = {}, opts = {}) {
  const exportOpts = { activeOnly: false, ...opts };
  const exportContext = await loadFullExportContext(user, query, exportOpts);
  const reportSheets = await buildExportReportSheets(user, query, exportContext, exportOpts);
  appendFundAndRepairSheets(workbook, reportSheets);
  return {
    fundCount: reportSheets.fundRows.length,
    repairCount: reportSheets.repairRows.length,
    neverCount: reportSheets.neverRows.length,
    oldCount: reportSheets.oldRows.length,
  };
}

async function generateFullExportBuffer(user, query = {}, opts = {}) {
  const accountantExport = isAccountantExport(user, opts);
  const exportOpts = {
    activeOnly: false,
    geocode: opts.geocode !== false,
    ...opts,
    includeFreshVisitSheets: opts.includeFreshVisitSheets ?? accountantExport,
    excludeFreshVisits: opts.excludeFreshVisits ?? !accountantExport,
  };
  const exportContext = await loadFullExportContext(user, query, exportOpts);
  const [fridgeRows, reportSheets] = await Promise.all([
    fetchFridgeListSheetRows(user, query, exportOpts, exportContext),
    buildExportReportSheets(user, query, exportContext, exportOpts),
  ]);
  return buildSalesReportWorkbook(reportSheets, fridgeRows);
}

async function generateSalesReportBuffer(user, query, opts = {}) {
  return generateFullExportBuffer(user, query, { geocode: false, ...opts });
}

function buildExportFileName(cityName) {
  return buildFridgesExportFileName(cityName);
}

module.exports = {
  buildFridgeQuery,
  fetchFundSheetRows,
  fetchRepairSheetRows,
  fetchVisitCategorySheets,
  fetchCheckinSummarySheetRows,
  fetchFridgeListSheetRows,
  generateFullExportBuffer,
  generateSalesReportBuffer,
  appendSalesReportSheets,
  buildExportFileName,
  buildFridgesExportFileName,
  isAccountantExport,
};
