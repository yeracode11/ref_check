const express = require('express');
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const Repair = require('../models/Repair');
const City = require('../models/City');
const User = require('../models/User');
const { authenticateToken, requireSalesHead } = require('../middleware/auth');
const {
  buildCheckinFridgeIdCandidates,
  visitStatusFromLastVisit,
  getLastVisitFromStatsMap,
  resolveEquipmentStatus,
} = require('../lib/fridgeVisitHelpers');
const { getCheckinStatsForFridges } = require('../lib/checkinStatsCache');
const {
  estimateRepairCostRecord,
  isComplexRepairRecord,
  getEquipmentIndicator,
} = require('../lib/repairHelpers');
const {
  resolveCityFilter,
  getCheckinFridgeIdsForCity,
  getFridgeObjectIdsForCity,
  getAssignedCityId,
} = require('../lib/cityScope');
const { labelsFromCompletedWorks } = require('../lib/mxoRepairWorks');

const router = express.Router();

function ensureSalesCityScope(req, res) {
  if (req.user.role === 'sales_head' && !getAssignedCityId(req.user)) {
    res.status(403).json({ error: 'Для НОП не назначен город. Обратитесь к администратору.' });
    return false;
  }
  return true;
}

function parseDate(dateString) {
  if (!dateString) return undefined;
  const d = new Date(dateString);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// GET /api/sales/fridges — список для НОП с фильтрами
router.get('/fridges', authenticateToken, requireSalesHead, async (req, res) => {
  try {
    if (!ensureSalesCityScope(req, res)) return;
    const { cityId, equipmentStatus, search, limit, skip } = req.query;
    const filter = { active: true };

    const scopedCityId = resolveCityFilter(req.user, cityId);
    if (scopedCityId) {
      filter.cityId = scopedCityId;
    }

    if (equipmentStatus === 'faulty') {
      filter.status = { $in: ['broken', 'under_repair'] };
    } else if (equipmentStatus && ['working', 'broken', 'under_repair'].includes(equipmentStatus)) {
      filter.status = equipmentStatus;
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

    const limitNum = limit ? Math.max(1, Math.min(500, Number(limit))) : 100;
    const skipNum = skip ? Math.max(0, Number(skip)) : 0;

    const [fridges, total] = await Promise.all([
      Fridge.find(filter)
        .populate('cityId', 'name code')
        .sort({ updatedAt: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Fridge.countDocuments(filter),
    ]);

    const fridgeIds = fridges.map((f) => f._id);
    const activeRepairs = await Repair.find({
      fridgeId: { $in: fridgeIds },
      status: 'in_progress',
    }).lean();
    const repairByFridge = new Map(activeRepairs.map((r) => [String(r.fridgeId), r]));

    const data = fridges.map((f) => {
      const activeRepair = repairByFridge.get(String(f._id)) || null;
      return {
        ...f,
        equipmentIndicator: getEquipmentIndicator(f, activeRepair),
        isComplexRepair: activeRepair ? isComplexRepairRecord(activeRepair) : false,
        activeRepair,
      };
    });

    return res.json({ data, total, limit: limitNum, skip: skipNum });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch fridges for sales', details: err.message });
  }
});

// GET /api/sales/map — холодильники для карты (только город НОП / выбранный город у админа)
router.get('/map', authenticateToken, requireSalesHead, async (req, res) => {
  try {
    if (!ensureSalesCityScope(req, res)) return;
    const scopedCityId = resolveCityFilter(req.user, req.query.cityId);
    const fridgeQuery = { active: true };
    if (scopedCityId) {
      fridgeQuery.cityId = scopedCityId;
    }

    const fridges = await Fridge.find(fridgeQuery)
      .populate('cityId', 'name code')
      .sort({ createdAt: -1 })
      .lean();

    const cacheScopeKey = JSON.stringify({ ...fridgeQuery, route: 'sales-map' });
    const statsByFridgeId = await getCheckinStatsForFridges(fridges, cacheScopeKey, { useCache: true });
    const now = Date.now();

    const result = fridges.map((f) => {
      const { lastVisit, lastVisitTime, lastFridgeCondition } = getLastVisitFromStatsMap(statsByFridgeId, f);
      const visitStatus = visitStatusFromLastVisit(lastVisit, { nowMs: now });

      if (lastVisitTime != null && lastVisitTime > now) {
        console.warn(
          `[Sales] lastVisit in future for fridge ${f.code}: now=${new Date(now).toISOString()} last=${new Date(lastVisitTime).toISOString()}`,
        );
      }

      let status;
      const warehouseStatus = f.warehouseStatus || 'warehouse';

      if (!lastVisit) {
        status = 'never';
      } else if (warehouseStatus === 'returned') {
        status = 'never';
      } else {
        status = visitStatus;
      }

      const finalStatus = status === 'location_changed' ? (visitStatus || 'never') : status;

      return {
        id: f._id,
        code: f.code,
        name: f.name,
        address: f.address,
        city: f.cityId || null,
        location: f.location,
        lastVisit,
        status: finalStatus,
        warehouseStatus,
        visitStatus,
        equipmentStatus: resolveEquipmentStatus(f.status, lastFridgeCondition),
        clientInfo: f.clientInfo || null,
      };
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch map data for sales', details: err.message });
  }
});

// GET /api/sales/checkins — история отметок для НОП
router.get('/checkins', authenticateToken, requireSalesHead, async (req, res) => {
  try {
    if (!ensureSalesCityScope(req, res)) return;
    const { cityId, fridgeId, from, to, limit, skip } = req.query;
    const filter = {};

    if (fridgeId) {
      filter.fridgeId = String(fridgeId).trim().replace(/^#/, '');
    } else {
      const scopedCityId = resolveCityFilter(req.user, cityId);
      if (scopedCityId) {
        const ids = await getCheckinFridgeIdsForCity(scopedCityId);
        filter.fridgeId = { $in: ids.length ? ids : ['__none__'] };
      }
    }

    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (fromDate || toDate) {
      filter.visitedAt = {};
      if (fromDate) filter.visitedAt.$gte = fromDate;
      if (toDate) filter.visitedAt.$lte = toDate;
    }

    const limitNum = limit ? Math.max(1, Math.min(500, Number(limit))) : 100;
    const skipNum = skip ? Math.max(0, Number(skip)) : 0;

    const [items, total] = await Promise.all([
      Checkin.find(filter).sort({ visitedAt: -1 }).skip(skipNum).limit(limitNum).lean(),
      Checkin.countDocuments(filter),
    ]);

    const managerIds = [...new Set(items.map((i) => i.managerId).filter(Boolean))];
    const objectIds = managerIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find({
      $or: [{ username: { $in: managerIds } }, { _id: { $in: objectIds } }],
    }).select('username fullName role');
    const userMap = new Map();
    users.forEach((u) => {
      if (u.username) userMap.set(u.username, u);
      userMap.set(String(u._id), u);
    });

    const data = items.map((item) => {
      const user = userMap.get(item.managerId) || userMap.get(String(item.managerId));
      return {
        ...item,
        managerUsername: user?.username || item.managerId,
        managerFullName: user?.fullName || '',
        managerRole: user?.role || null,
      };
    });

    return res.json({ data, total, limit: limitNum, skip: skipNum });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch checkins for sales', details: err.message });
  }
});

// GET /api/sales/activity — объединённая лента отметок ТП и ремонтов МХО
router.get('/activity', authenticateToken, requireSalesHead, async (req, res) => {
  try {
    if (!ensureSalesCityScope(req, res)) return;
    const { cityId, limit } = req.query;
    const limitNum = limit ? Math.max(1, Math.min(100, Number(limit))) : 50;
    const scopedCityId = resolveCityFilter(req.user, cityId);

    const fridgeFilter = { active: true };
    if (scopedCityId) {
      fridgeFilter.cityId = scopedCityId;
    }

    const fridges = await Fridge.find(fridgeFilter)
      .select('_id code number name')
      .lean();
    const fridgeIds = fridges.map((f) => f._id);
    const fridgeById = new Map(fridges.map((f) => [String(f._id), f]));

    const checkinFilter = {};
    if (scopedCityId) {
      const ids = await getCheckinFridgeIdsForCity(scopedCityId);
      checkinFilter.fridgeId = { $in: ids.length ? ids : ['__none__'] };
    }

    const fetchLimit = Math.min(limitNum * 3, 150);
    const [checkinItems, repairItems] = await Promise.all([
      Checkin.find(checkinFilter).sort({ visitedAt: -1 }).limit(fetchLimit).lean(),
      Repair.find({ fridgeId: { $in: fridgeIds.length ? fridgeIds : [null] } })
        .sort({ repairDate: -1 })
        .limit(fetchLimit)
        .lean(),
    ]);

    const managerIds = [...new Set(checkinItems.map((i) => i.managerId).filter(Boolean))];
    const technicianIds = [...new Set(repairItems.map((r) => String(r.technicianId)).filter(Boolean))];
    const objectIds = [...new Set([...managerIds, ...technicianIds])]
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const users = await User.find({
      $or: [
        { username: { $in: [...managerIds, ...technicianIds] } },
        { _id: { $in: objectIds } },
      ],
    }).select('username fullName role').lean();

    const userMap = new Map();
    users.forEach((u) => {
      if (u.username) userMap.set(u.username, u);
      userMap.set(String(u._id), u);
    });

    const checkinRows = checkinItems.map((item) => {
      const user = userMap.get(item.managerId) || userMap.get(String(item.managerId));
      return {
        type: 'checkin',
        id: item.id,
        at: item.visitedAt,
        actorFullName: user?.fullName || '',
        actorUsername: user?.username || item.managerId,
        actorRole: user?.role || 'manager',
        fridgeId: item.fridgeId,
        fridgeCondition: item.fridgeCondition,
        isSeasonalClosure: item.isSeasonalClosure,
        notes: item.notes,
      };
    });

    const repairRows = repairItems.map((r) => {
      const tech = userMap.get(String(r.technicianId));
      const fridge = fridgeById.get(String(r.fridgeId));
      const workLabels = labelsFromCompletedWorks(r.completedWorks);
      return {
        type: 'repair',
        id: String(r._id),
        at: r.repairDate,
        actorFullName: tech?.fullName || '',
        actorUsername: tech?.username || '',
        actorRole: tech?.role || 'service_manager',
        fridgeId: fridge?.number || fridge?.code || String(r.fridgeId),
        fridgeCode: fridge?.code,
        fridgeName: fridge?.name,
        completedWorks: r.completedWorks || [],
        workLabels,
        workType: r.workType,
        comment: r.comment,
        status: r.status,
        completedAt: r.completedAt,
        isComplexRepair: isComplexRepairRecord(r),
        estimatedCostKzt: estimateRepairCostRecord(r),
      };
    });

    const merged = [...checkinRows, ...repairRows]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limitNum);

    return res.json({ data: merged, total: merged.length, limit: limitNum });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch activity for sales', details: err.message });
  }
});

// GET /api/sales/analytics — аналитика поломок и затрат на ремонт
router.get('/analytics', authenticateToken, requireSalesHead, async (req, res) => {
  try {
    if (!ensureSalesCityScope(req, res)) return;
    const days = Math.max(7, Math.min(365, Number(req.query.days) || 90));
    const scopedCityId = resolveCityFilter(req.user, req.query.cityId);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const fridgeFilter = { active: true };
    if (scopedCityId) {
      fridgeFilter.cityId = scopedCityId;
    }

    const fridges = await Fridge.find(
      fridgeFilter,
      { _id: 1, status: 1, cityId: 1, code: 1, number: 1, 'clientInfo.inn': 1 },
    ).lean();
    const fridgeIds = fridges.map((f) => f._id);
    const checkinFridgeIds = new Set();
    fridges.forEach((f) => {
      buildCheckinFridgeIdCandidates(f).forEach((id) => checkinFridgeIds.add(id));
    });
    const checkinIdList = [...checkinFridgeIds];

    const citiesQuery = { active: true };
    if (scopedCityId) citiesQuery._id = scopedCityId;

    const [repairs, brokenCheckins, cities] = await Promise.all([
      Repair.find({
        fridgeId: { $in: fridgeIds },
        repairDate: { $gte: since },
      }).lean(),
      Checkin.find({
        fridgeCondition: 'broken',
        visitedAt: { $gte: since },
        ...(checkinIdList.length ? { fridgeId: { $in: checkinIdList } } : { fridgeId: '__none__' }),
      }).lean(),
      City.find(citiesQuery).select('name code').lean(),
    ]);

    const breakdownsByDay = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      breakdownsByDay[key] = { date: key, breakdowns: 0, repairs: 0, costKzt: 0 };
    }

    brokenCheckins.forEach((c) => {
      const key = new Date(c.visitedAt).toISOString().slice(0, 10);
      if (breakdownsByDay[key]) breakdownsByDay[key].breakdowns += 1;
    });

    repairs.forEach((r) => {
      const key = new Date(r.repairDate).toISOString().slice(0, 10);
      if (breakdownsByDay[key]) {
        breakdownsByDay[key].repairs += 1;
        breakdownsByDay[key].costKzt += estimateRepairCostRecord(r);
      }
    });

    const dailyStats = Object.values(breakdownsByDay).sort((a, b) => a.date.localeCompare(b.date));

    const statusCounts = {
      working: fridges.filter((f) => f.status === 'working' || !f.status).length,
      broken: fridges.filter((f) => f.status === 'broken').length,
      under_repair: fridges.filter((f) => f.status === 'under_repair').length,
    };

    const partsCost = {};
    const { labelsFromCompletedWorks } = require('../lib/mxoRepairWorks');
    repairs.forEach((r) => {
      const labels = labelsFromCompletedWorks(r.completedWorks);
      const items = labels.length ? labels : (r.replacedParts || []);
      items.forEach((part) => {
        const p = String(part).trim();
        if (!p) return;
        partsCost[p] = (partsCost[p] || 0) + 1;
      });
    });
    const topParts = Object.entries(partsCost)
      .map(([part, count]) => ({
        part,
        count,
        estimatedCostKzt: Math.round((estimateRepairCostRecord({ completedWorks: [], replacedParts: [part] }) || 10000) * count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalRepairCostKzt = repairs.reduce(
      (sum, r) => sum + estimateRepairCostRecord(r),
      0,
    );

    return res.json({
      dailyStats,
      statusCounts,
      topParts,
      summary: {
        totalFridges: fridges.length,
        faultyFridges: statusCounts.broken + statusCounts.under_repair,
        totalRepairs: repairs.length,
        totalRepairCostKzt,
        breakdownReports: brokenCheckins.length,
        days,
      },
      cities,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sales analytics', details: err.message });
  }
});

module.exports = router;
