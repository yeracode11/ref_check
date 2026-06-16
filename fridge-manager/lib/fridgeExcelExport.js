const axios = require('axios');
const XLSX = require('xlsx');
const Fridge = require('../models/Fridge');
const {
  combinedVisitMapStatus,
  getLastVisitFromStatsMap,
} = require('./fridgeVisitHelpers');
const { getCheckinStatsForFridges } = require('./checkinStatsCache');
const { resolveCityFilter } = require('./cityScope');

const NUMBER_CITIES = new Set(['Шымкент', 'Кызылорда', 'Талдыкорган']);

function sortFridgesForExport(fridges) {
  return [...fridges].sort((a, b) => {
    const isNumberCityA = NUMBER_CITIES.has(a.cityId?.name);
    const isNumberCityB = NUMBER_CITIES.has(b.cityId?.name);
    if (isNumberCityA && isNumberCityB) {
      return (a.number || '').localeCompare(b.number || '');
    }
    if (isNumberCityA) return -1;
    if (isNumberCityB) return 1;
    return (a.code || '').localeCompare(b.code || '');
  });
}

function buildEquipmentStatusFilter(equipmentStatus) {
  if (!equipmentStatus || equipmentStatus === 'all') return null;
  if (equipmentStatus === 'faulty') return { $in: ['broken', 'under_repair'] };
  if (['working', 'broken', 'under_repair'].includes(equipmentStatus)) return equipmentStatus;
  return null;
}

function buildExportFridgeFilter(user, query = {}, opts = {}) {
  const filter = {};
  const scopedCityId = resolveCityFilter(user, query.cityId);
  if (scopedCityId) {
    filter.cityId = scopedCityId;
  }
  if (opts.activeOnly === true) {
    filter.active = true;
  }

  const { equipmentStatus, search } = query;
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

function formatLastVisitLocal(lastVisit) {
  if (!lastVisit) return '';
  const date = new Date(lastVisit);
  const localTime = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return localTime.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function createReverseGeocoder(enableGeocoding) {
  const geocodeCache = new Map();
  let lastGeocodeRequest = 0;

  async function reverseGeocode(lat, lng) {
    if (!enableGeocoding || !lat || !lng || (lat === 0 && lng === 0)) return null;

    const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (geocodeCache.has(cacheKey)) {
      return geocodeCache.get(cacheKey);
    }

    try {
      const now = Date.now();
      const timeSinceLastRequest = now - lastGeocodeRequest;
      if (timeSinceLastRequest < 1000) {
        await new Promise((resolve) => setTimeout(resolve, 1000 - timeSinceLastRequest));
      }
      lastGeocodeRequest = Date.now();

      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          headers: { 'User-Agent': 'FridgeManager/1.0' },
          timeout: 5000,
        },
      );

      if (response.data?.address) {
        const addr = response.data.address;
        const parts = [];
        if (addr.road) parts.push(addr.road);
        if (addr.house_number) parts.push(addr.house_number);
        if (addr.city || addr.town || addr.village) {
          parts.push(addr.city || addr.town || addr.village);
        }
        const address = parts.length > 0 ? parts.join(', ') : response.data.display_name || null;
        if (address) {
          geocodeCache.set(cacheKey, address);
          return address;
        }
      }
      return null;
    } catch (error) {
      console.error('[Geocoding] Error:', error.message);
      return null;
    }
  }

  return reverseGeocode;
}

/**
 * Лист «Холодильники» — тот же формат, что у бухгалтера.
 */
async function fetchFridgeListSheetRows(user, query = {}, opts = {}) {
  const enableGeocoding = opts.geocode !== false;
  const fridgeFilter = buildExportFridgeFilter(user, query, opts);
  const fridges = await Fridge.find(fridgeFilter).populate('cityId', 'name code').lean();
  const sorted = sortFridgesForExport(fridges);
  const statsByFridgeId = await getCheckinStatsForFridges(
    sorted,
    JSON.stringify({ ...fridgeFilter, sheet: 'fridges' }),
    { useCache: false },
  );
  const reverseGeocode = await createReverseGeocoder(enableGeocoding);
  const now = Date.now();
  const rows = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const f = sorted[i];
    const { lastVisit } = getLastVisitFromStatsMap(statsByFridgeId, f);
    const mapSt = combinedVisitMapStatus(lastVisit, f.warehouseStatus, {
      nowMs: now,
      fridgeType: f.type,
    });
    const status =
      mapSt === 'today' ? 'Сегодня'
        : mapSt === 'week' ? 'Неделя'
          : mapSt === 'old' ? 'Давно'
            : 'Нет отметок';

    let warehouseStatusLabel = '';
    let isReturned = false;
    if (f.warehouseStatus === 'warehouse') warehouseStatusLabel = 'На складе';
    else if (f.warehouseStatus === 'installed') warehouseStatusLabel = 'Установлен';
    else if (f.warehouseStatus === 'returned') {
      warehouseStatusLabel = 'Возврат';
      isReturned = true;
    } else if (f.warehouseStatus === 'moved') warehouseStatusLabel = 'Перемещён';

    let geocodedAddress = '';
    if (f.location?.coordinates && f.location.coordinates[0] !== 0 && f.location.coordinates[1] !== 0) {
      const [lng, lat] = f.location.coordinates;
      if (enableGeocoding) {
        const addr = await reverseGeocode(lat, lng);
        geocodedAddress = addr || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      } else {
        geocodedAddress = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }
    }

    rows.push({
      'Код': f.code || '',
      'Номер': f.number || '',
      'Название': f.name || '',
      'Город': f.cityId?.name || '',
      'Адрес': f.address || '',
      'Адрес по координатам': geocodedAddress,
      'Описание': f.description || '',
      'Тип объекта': f.type === 'school' ? 'Школа' : f.type === 'restricted' ? 'Режимный' : 'Обычный',
      'Объект закрыт на каникулы': f.isSeasonalClosure ? 'Да' : 'Нет',
      'Статус склада': warehouseStatusLabel,
      'Возврат': isReturned ? 'Да' : 'Нет',
      'Статус визита': status,
      'Последний визит': formatLastVisitLocal(lastVisit),
      'Активен': f.active ? 'Да' : 'Нет',
    });

    if (enableGeocoding && i < sorted.length - 1 && i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return rows;
}

const FRIDGE_LIST_COLUMN_WIDTHS = [
  { wch: 10 }, { wch: 30 }, { wch: 30 }, { wch: 15 }, { wch: 40 },
  { wch: 50 }, { wch: 30 }, { wch: 14 }, { wch: 28 }, { wch: 18 },
  { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 10 },
];

function appendFridgeListSheet(workbook, fridgeRows) {
  const worksheet = XLSX.utils.json_to_sheet(fridgeRows);
  worksheet['!cols'] = FRIDGE_LIST_COLUMN_WIDTHS;
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Холодильники');
}

function buildFridgesExportFileName(cityName) {
  const date = new Date().toISOString().split('T')[0];
  const cityPart = cityName ? `_${cityName.replace(/\s+/g, '_')}` : '';
  return `холодильники${cityPart}_${date}.xlsx`;
}

module.exports = {
  fetchFridgeListSheetRows,
  appendFridgeListSheet,
  buildFridgesExportFileName,
  buildExportFridgeFilter,
  FRIDGE_LIST_COLUMN_WIDTHS,
};
