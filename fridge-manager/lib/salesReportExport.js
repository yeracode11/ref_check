const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const Repair = require('../models/Repair');
const XLSX = require('xlsx');
const {
  buildCheckinFridgeIdCandidates,
  getLastVisitFromStatsMap,
} = require('./fridgeVisitHelpers');
const { getCheckinStatsForFridges } = require('./checkinStatsCache');
const { resolveCityFilter } = require('./cityScope');
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

function buildFridgeQuery(user, query = {}) {
  const { cityId, equipmentStatus, search } = query;
  const filter = { active: true };

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
  const brokenRows = await Checkin.find({
    fridgeId: { $in: checkinIdList.length ? checkinIdList : ['__none__'] },
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
async function fetchFundSheetRows(user, query) {
  const fridgeFilter = buildFridgeQuery(user, query);
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
      'Флаг каникул': f.isSeasonalClosure ? 'Да' : 'Нет',
      'Общее кол-во чекинов': totalCheckins || 0,
      'Кол-во поломок за всё время': brokenByFridgeId.get(String(f._id)) || 0,
    };
  });
}

/**
 * Лист 2: лог ремонтов МХО ($lookup fridges + users).
 */
async function fetchRepairSheetRows(user, query) {
  const fridgeFilter = buildFridgeQuery(user, query);
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

function buildSalesReportWorkbook(fundRows, repairRows) {
  const fundSheet = XLSX.utils.json_to_sheet(fundRows);
  fundSheet['!cols'] = [
    { wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 28 },
    { wch: 14 }, { wch: 18 }, { wch: 22 },
  ];

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

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, fundSheet, 'Состояние фонда');
  XLSX.utils.book_append_sheet(workbook, repairSheet, 'История ремонтов');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function generateSalesReportBuffer(user, query) {
  const [fundRows, repairRows] = await Promise.all([
    fetchFundSheetRows(user, query),
    fetchRepairSheetRows(user, query),
  ]);
  return buildSalesReportWorkbook(fundRows, repairRows);
}

function buildExportFileName(cityName) {
  const date = new Date().toISOString().split('T')[0];
  const cityPart = cityName ? `_${cityName.replace(/\s+/g, '_')}` : '';
  return `отчет_НОП${cityPart}_${date}.xlsx`;
}

module.exports = {
  buildFridgeQuery,
  fetchFundSheetRows,
  fetchRepairSheetRows,
  generateSalesReportBuffer,
  buildExportFileName,
};
