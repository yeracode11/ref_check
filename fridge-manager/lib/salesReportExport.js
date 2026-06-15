const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const Repair = require('../models/Repair');
const XLSX = require('xlsx');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  getLastVisitFromStatsMap,
} = require('./fridgeVisitHelpers');
const { getCheckinStatsForFridges } = require('./checkinStatsCache');
const { resolveCityFilter, getCheckinFridgeIdsForCity } = require('./cityScope');
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
    const searchRegex = new RegExp(String(search).trim(), 'i');
    filter.$or = [
      { name: searchRegex },
      { code: searchRegex },
      { number: searchRegex },
      { address: searchRegex },
    ];
  }

  return filter;
}

async function countBrokenCheckinsByFridge(fridges, checkinIdList) {
  const expandedIds = expandCheckinFridgeIdsForInQuery(checkinIdList);
  const brokenRows = await Checkin.find({
    fridgeId: { $in: expandedIds.length ? expandedIds : ['__none__'] },
    fridgeCondition: 'broken',
  }).select('fridgeId').lean();

  const fridgeByCheckinId = new Map();
  for (const fridge of fridges) {
    const fridgeKey = String(fridge._id);
    for (const id of buildCheckinFridgeIdCandidates(fridge)) {
      fridgeByCheckinId.set(String(id).trim(), fridgeKey);
      const n = Number(id);
      if (Number.isFinite(n)) {
        fridgeByCheckinId.set(String(n), fridgeKey);
      }
    }
  }

  const result = new Map();
  for (const row of brokenRows) {
    const fridgeKey = fridgeByCheckinId.get(String(row.fridgeId).trim());
    if (!fridgeKey) continue;
    result.set(fridgeKey, (result.get(fridgeKey) || 0) + 1);
  }
  return result;
}

/**
 * Лист 1: состояние фонда холодильников региона НОП.
 */
async function fetchFundSheetRows(user, query, opts = {}) {
  const fridgeFilter = buildFridgeQuery(user, query, opts);
  const fridges = await Fridge.find(fridgeFilter)
    .populate('cityId', 'name code')
    .sort({ createdAt: -1 })
    .lean();

  const cacheScopeKey = JSON.stringify({ ...fridgeFilter, export: 'sales-fund' });
  const statsByFridgeId = await getCheckinStatsForFridges(fridges, cacheScopeKey, { useCache: false });

  const checkinIdSet = new Set();
  fridges.forEach((f) => {
    buildCheckinFridgeIdCandidates(f).forEach((id) => checkinIdSet.add(id));
  });
  const brokenByFridgeId = await countBrokenCheckinsByFridge(fridges, [...checkinIdSet]);

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
 * Лист 2: лог ремонтов МХО ($lookup fridges + users).
 */
async function fetchRepairSheetRows(user, query, opts = {}) {
  const fridgeFilter = buildFridgeQuery(user, query, opts);
  const fridgeIds = await Fridge.find(fridgeFilter).distinct('_id');

  if (!fridgeIds.length) return [];

  const repairs = await Repair.aggregate([
    { $match: { fridgeId: { $in: fridgeIds } } },
    { $sort: { repairDate: -1 } },
    {
      $lookup: {
        from: 'fridges',
        localField: 'fridgeId',
        foreignField: '_id',
        as: 'fridge',
      },
    },
    { $unwind: { path: '$fridge', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'users',
        localField: 'technicianId',
        foreignField: '_id',
        as: 'technician',
      },
    },
    { $unwind: { path: '$technician', preserveNullAndEmptyArrays: true } },
  ]);

  return repairs.map((r) => {
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
      'ID Холодильника': r.fridge ? getFridgeDisplayId(r.fridge) : String(r.fridgeId),
      'Адрес точки': r.fridge?.address || '',
      'Вид выполненных работ': r.workType || '',
      'Перечень замененных деталей': partsList,
      'Ответственный сотрудник МХО': r.technician?.fullName || r.technician?.username || '',
      'Комментарий МХО': r.comment || '',
      'Сложный ремонт': complex ? 'Да' : 'Нет',
      _isComplexRepair: complex,
    };
  });
}

/**
 * Лист 3: история отметок ТП по городу НОП.
 */
async function fetchCheckinSheetRows(user, query, opts = {}) {
  const fridgeFilter = buildFridgeQuery(user, query, opts);
  const scopedCityId = resolveCityFilter(user, query.cityId);
  const fridges = await Fridge.find(fridgeFilter)
    .select('_id code number name address clientInfo')
    .lean();

  const fridgeByCheckinId = new Map();
  fridges.forEach((f) => {
    for (const id of buildCheckinFridgeIdCandidates(f)) {
      fridgeByCheckinId.set(String(id).trim(), f);
      const n = Number(id);
      if (Number.isFinite(n)) fridgeByCheckinId.set(String(n), f);
    }
  });

  let checkinFilter = {};
  if (scopedCityId) {
    const ids = await getCheckinFridgeIdsForCity(scopedCityId);
    checkinFilter = { fridgeId: { $in: ids.length ? ids : ['__none__'] } };
  } else if (fridges.length) {
    const ids = expandCheckinFridgeIdsForInQuery(
      fridges.flatMap((f) => buildCheckinFridgeIdCandidates(f)),
    );
    checkinFilter = { fridgeId: { $in: ids.length ? ids : ['__none__'] } };
  } else {
    return [];
  }

  const User = require('../models/User');
  const checkins = await Checkin.find(checkinFilter)
    .sort({ visitedAt: -1 })
    .limit(5000)
    .lean();

  const managerIds = [...new Set(checkins.map((c) => c.managerId).filter(Boolean))];
  const users = await User.find({
    $or: [
      { username: { $in: managerIds } },
      { _id: { $in: managerIds.filter((id) => /^[a-fA-F0-9]{24}$/.test(String(id))) } },
    ],
  }).select('username fullName').lean();
  const userMap = new Map();
  users.forEach((u) => {
    if (u.username) userMap.set(u.username, u);
    userMap.set(String(u._id), u);
  });

  return checkins.map((c) => {
    const fridge = fridgeByCheckinId.get(String(c.fridgeId).trim());
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
      'Название точки': fridge?.name || '',
      'Адрес точки': fridge?.address || c.address || '',
      'Сотрудник ТП': manager?.fullName || manager?.username || c.managerId || '',
      'Состояние': c.fridgeCondition === 'broken' ? 'Сломан' : 'Рабочий',
      'Закрыт на каникулы': c.isSeasonalClosure ? 'Да' : 'Нет',
      'Комментарий': c.notes || '',
    };
  });
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

function appendFundAndRepairSheets(workbook, fundRows, repairRows, checkinRows = []) {
  const fundSheet = XLSX.utils.json_to_sheet(fundRows);
  fundSheet['!cols'] = [
    { wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 28 },
    { wch: 14 }, { wch: 18 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, fundSheet, 'Состояние фонда');

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

  const checkinSheet = XLSX.utils.json_to_sheet(checkinRows);
  checkinSheet['!cols'] = [
    { wch: 20 }, { wch: 18 }, { wch: 28 }, { wch: 40 }, { wch: 24 },
    { wch: 14 }, { wch: 18 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(workbook, checkinSheet, 'Отметки ТП');
}

function buildSalesReportWorkbook(fundRows, repairRows, checkinRows = [], fridgeRows = null) {
  const workbook = XLSX.utils.book_new();
  if (fridgeRows) {
    appendFridgeListSheet(workbook, fridgeRows);
  }
  appendFundAndRepairSheets(workbook, fundRows, repairRows, checkinRows);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Добавляет листы НОП (состояние фонда + ремонты МХО) в существующую книгу Excel.
 * Для админского экспорта: activeOnly=false — тот же охват, что и лист «Холодильники».
 */
async function appendSalesReportSheets(workbook, user, query = {}, opts = {}) {
  const [fundRows, repairRows, checkinRows] = await Promise.all([
    fetchFundSheetRows(user, query, opts),
    fetchRepairSheetRows(user, query, opts),
    fetchCheckinSheetRows(user, query, opts),
  ]);
  appendFundAndRepairSheets(workbook, fundRows, repairRows, checkinRows);
  return { fundCount: fundRows.length, repairCount: repairRows.length, checkinCount: checkinRows.length };
}

async function generateFullExportBuffer(user, query = {}, opts = {}) {
  const exportOpts = { activeOnly: false, geocode: opts.geocode !== false, ...opts };
  const [fridgeRows, fundRows, repairRows, checkinRows] = await Promise.all([
    fetchFridgeListSheetRows(user, query, exportOpts),
    fetchFundSheetRows(user, query, exportOpts),
    fetchRepairSheetRows(user, query, exportOpts),
    fetchCheckinSheetRows(user, query, exportOpts),
  ]);
  return buildSalesReportWorkbook(fundRows, repairRows, checkinRows, fridgeRows);
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
  fetchCheckinSheetRows,
  fetchFridgeListSheetRows,
  generateFullExportBuffer,
  generateSalesReportBuffer,
  appendSalesReportSheets,
  buildExportFileName,
  buildFridgesExportFileName,
};
