type MapFridge = {
  city?: { _id?: string; name?: string; code?: string } | null;
  visitStatus?: string;
  warehouseStatus?: string;
  locationAtDepot?: boolean;
  status?: string;
};

type CityStatRow = {
  cityId: string;
  cityName: string;
  cityCode: string;
  total: number;
  fresh: number;
  old: number;
  never: number;
  warehouse: number;
  installed: number;
  returned: number;
  moved: number;
};

export function buildCityStatisticsFromMapFridges(fridges: MapFridge[]) {
  const cityStatsMap = new Map<string, CityStatRow>();

  fridges.forEach((f) => {
    const cityId = f.city?._id?.toString() || 'unknown';
    const cityName = f.city?.name || 'Не указан';
    const cityCode = f.city?.code || '';

    if (!cityStatsMap.has(cityId)) {
      cityStatsMap.set(cityId, {
        cityId,
        cityName,
        cityCode,
        total: 0,
        fresh: 0,
        old: 0,
        never: 0,
        warehouse: 0,
        installed: 0,
        returned: 0,
        moved: 0,
      });
    }

    const stats = cityStatsMap.get(cityId)!;
    stats.total++;

    const visitStatus = f.visitStatus || f.status || 'never';
    const warehouseStatus = f.warehouseStatus || 'warehouse';
    const atDepot = warehouseStatus === 'warehouse' && f.locationAtDepot !== false;

    if (visitStatus === 'never' || warehouseStatus === 'returned' || atDepot) {
      stats.never++;
    } else if (visitStatus === 'today' || visitStatus === 'week') {
      stats.fresh++;
    } else {
      stats.old++;
    }

    if (warehouseStatus === 'warehouse') stats.warehouse++;
    else if (warehouseStatus === 'installed') stats.installed++;
    else if (warehouseStatus === 'returned') stats.returned++;
    else if (warehouseStatus === 'moved') stats.moved++;
  });

  const cities = Array.from(cityStatsMap.values()).sort((a, b) =>
    a.cityName.localeCompare(b.cityName, 'ru'),
  );

  return {
    cities,
    summary: {
      totalCities: cities.length,
      totalFridges: cities.reduce((sum, c) => sum + c.total, 0),
      totalFresh: cities.reduce((sum, c) => sum + c.fresh, 0),
      totalOld: cities.reduce((sum, c) => sum + c.old, 0),
      totalNever: cities.reduce((sum, c) => sum + c.never, 0),
    },
  };
}
