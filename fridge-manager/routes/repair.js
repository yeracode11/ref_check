const express = require('express');
const mongoose = require('mongoose');
const Repair = require('../models/Repair');
const Fridge = require('../models/Fridge');
const {
  authenticateToken,
  requireAdminOrServiceManager,
} = require('../middleware/auth');
const { isComplexRepair, estimateRepairCostKzt } = require('../lib/repairHelpers');
const { getAssignedCityId, getFridgeObjectIdsForCity, userCanAccessCity } = require('../lib/cityScope');

const router = express.Router();

function parseObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

// POST /api/repairs — создание записи о ремонте
router.post('/', authenticateToken, requireAdminOrServiceManager, async (req, res) => {
  try {
    const {
      fridgeId,
      repairDate,
      workType,
      replacedParts,
      comment,
      completeImmediately,
    } = req.body;

    const fridgeOid = parseObjectId(fridgeId);
    if (!fridgeOid) {
      return res.status(400).json({ error: 'Valid fridgeId is required' });
    }
    if (!workType || !String(workType).trim()) {
      return res.status(400).json({ error: 'workType is required' });
    }

    const fridge = await Fridge.findById(fridgeOid);
    if (!fridge) {
      return res.status(404).json({ error: 'Fridge not found' });
    }
    if (!userCanAccessCity(req.user, fridge.cityId)) {
      return res.status(403).json({ error: 'Access denied for this city' });
    }

    const parts = Array.isArray(replacedParts)
      ? replacedParts.map((p) => String(p).trim()).filter(Boolean)
      : [];

    const shouldComplete = completeImmediately === true || completeImmediately === 'true';
    const now = new Date();
    const parsedDate = repairDate ? new Date(repairDate) : now;
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid repairDate' });
    }

    const repair = await Repair.create({
      fridgeId: fridgeOid,
      repairDate: parsedDate,
      workType: String(workType).trim(),
      replacedParts: parts,
      technicianId: req.user.id,
      comment: comment ? String(comment).trim() : undefined,
      status: shouldComplete ? 'completed' : 'in_progress',
      completedAt: shouldComplete ? now : undefined,
    });

    const fridgeUpdate = {
      status: shouldComplete ? 'working' : 'under_repair',
    };
    if (!shouldComplete && !fridge.brokenSince) {
      fridgeUpdate.brokenSince = parsedDate;
    }
    if (shouldComplete) {
      fridgeUpdate.brokenSince = null;
    }

    await Fridge.findByIdAndUpdate(fridgeOid, { $set: fridgeUpdate });

    const populated = await Repair.findById(repair._id)
      .populate('technicianId', 'username fullName')
      .populate('fridgeId', 'code name number status');

    return res.status(201).json({
      ...populated.toObject(),
      isComplexRepair: isComplexRepair(parts),
      estimatedCostKzt: estimateRepairCostKzt(parts),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create repair', details: err.message });
  }
});

// PATCH /api/repairs/:id/complete — завершение ремонта
router.patch('/:id/complete', authenticateToken, requireAdminOrServiceManager, async (req, res) => {
  try {
    const repairOid = parseObjectId(req.params.id);
    if (!repairOid) {
      return res.status(400).json({ error: 'Invalid repair id' });
    }

    const repair = await Repair.findById(repairOid);
    if (!repair) {
      return res.status(404).json({ error: 'Repair not found' });
    }
    const repairFridge = await Fridge.findById(repair.fridgeId).select('cityId');
    if (!repairFridge || !userCanAccessCity(req.user, repairFridge.cityId)) {
      return res.status(403).json({ error: 'Access denied for this city' });
    }
    if (repair.status === 'completed') {
      return res.status(400).json({ error: 'Repair is already completed' });
    }

    const completedAt = new Date();
    repair.status = 'completed';
    repair.completedAt = completedAt;
    await repair.save();

    await Fridge.findByIdAndUpdate(repair.fridgeId, {
      $set: { status: 'working', brokenSince: null },
    });

    const populated = await Repair.findById(repair._id)
      .populate('technicianId', 'username fullName')
      .populate('fridgeId', 'code name number status');

    return res.json(populated);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to complete repair', details: err.message });
  }
});

// GET /api/repairs?fridgeId=
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { fridgeId, status, limit, skip } = req.query;
    const filter = {};

    const fridgeOid = parseObjectId(fridgeId);
    if (fridgeId && !fridgeOid) {
      return res.status(400).json({ error: 'Invalid fridgeId' });
    }
    if (fridgeOid) filter.fridgeId = fridgeOid;
    if (status && ['in_progress', 'completed'].includes(status)) {
      filter.status = status;
    }

    const cityId = getAssignedCityId(req.user);
    if (cityId) {
      const fridgeIds = await getFridgeObjectIdsForCity(cityId);
      if (fridgeOid) {
        if (!fridgeIds.some((id) => String(id) === String(fridgeOid))) {
          return res.status(403).json({ error: 'Access denied for this city' });
        }
      } else {
        filter.fridgeId = { $in: fridgeIds.length ? fridgeIds : [null] };
      }
    }

    const limitNum = limit ? Math.max(1, Math.min(200, Number(limit))) : 50;
    const skipNum = skip ? Math.max(0, Number(skip)) : 0;

    const [items, total] = await Promise.all([
      Repair.find(filter)
        .populate('technicianId', 'username fullName')
        .populate('fridgeId', 'code name number cityId status')
        .sort({ repairDate: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Repair.countDocuments(filter),
    ]);

    const data = items.map((r) => ({
      ...r,
      isComplexRepair: isComplexRepair(r.replacedParts),
      estimatedCostKzt: estimateRepairCostKzt(r.replacedParts),
    }));

    return res.json({ data, total, limit: limitNum, skip: skipNum });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch repairs', details: err.message });
  }
});

module.exports = router;
