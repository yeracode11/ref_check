const express = require('express');
const Fridge = require('../models/Fridge');

const router = express.Router();

// GET /api/fridges
router.get('/', async (req, res) => {
  try {
    const { active, nearLat, nearLng, nearKm } = req.query;
    const filter = {};
    if (active !== undefined) filter.active = active === 'true';

    const nearLatNum = nearLat ? Number(nearLat) : undefined;
    const nearLngNum = nearLng ? Number(nearLng) : undefined;
    const nearKmNum = nearKm ? Number(nearKm) : 5;

    if (typeof nearLatNum === 'number' && typeof nearLngNum === 'number') {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [nearLngNum, nearLatNum] },
          $maxDistance: Math.max(0, nearKmNum) * 1000,
        },
      };
    }

    const fridges = await Fridge.find(filter).sort({ createdAt: -1 });
    return res.json(fridges);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch fridges', details: err.message });
  }
});

// GET /api/fridges/:id
router.get('/:id', async (req, res) => {
  try {
    const fridge = await Fridge.findById(req.params.id);
    if (!fridge) return res.status(404).json({ error: 'Not found' });
    return res.json(fridge);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid id', details: err.message });
  }
});

// POST /api/fridges
router.post('/', async (req, res) => {
  try {
    const { code, name, address, description } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }

    let location = req.body.location;
    if (!location) {
      return res.status(400).json({ error: 'location is required' });
    }

    if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
      location = { type: 'Point', coordinates: [location.lng, location.lat] };
    }

    if (!location.type || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
      return res.status(400).json({ error: 'location must be GeoJSON Point or {lat,lng}' });
    }

    const fridge = await Fridge.create({ code, name, location, address, description });
    return res.status(201).json(fridge);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Fridge code already exists' });
    }
    return res.status(500).json({ error: 'Failed to create fridge', details: err.message });
  }
});

// PATCH /api/fridges/:id
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.location && typeof updates.location.lat === 'number' && typeof updates.location.lng === 'number') {
      updates.location = { type: 'Point', coordinates: [updates.location.lng, updates.location.lat] };
    }
    const fridge = await Fridge.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!fridge) return res.status(404).json({ error: 'Not found' });
    return res.json(fridge);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update fridge', details: err.message });
  }
});

// DELETE /api/fridges/:id
router.delete('/:id', async (req, res) => {
  try {
    const fridge = await Fridge.findByIdAndDelete(req.params.id);
    if (!fridge) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Fridge deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete fridge', details: err.message });
  }
});

module.exports = router;

