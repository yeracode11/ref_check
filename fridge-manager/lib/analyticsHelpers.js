const {
  getLastVisitFromStatsMap,
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  shouldIncludeInUnvisitedReport,
} = require('./fridgeVisitHelpers');

function buildCheckinIdListFromFridges(fridges) {
  const ids = new Set();
  for (const fridge of fridges) {
    for (const id of buildCheckinFridgeIdCandidates(fridge)) {
      ids.add(id);
    }
  }
  return expandCheckinFridgeIdsForInQuery([...ids]);
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
      lastVisit,
      daysSinceVisit: lastVisitDate
        ? Math.floor((Date.now() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };
  });

  return rows
    .filter((row) => shouldIncludeInUnvisitedReport(
      { type: row.type },
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

module.exports = {
  buildCheckinIdListFromFridges,
  buildTopUnvisitedFromFridges,
};
