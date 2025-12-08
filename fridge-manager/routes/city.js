const express = require('express');
const City = require('../models/City');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/cities
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    const filter = {};
    if (active !== undefined) filter.active = active === 'true';

    const cities = await City.find(filter).sort({ name: 1 });
    return res.json(cities);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch cities', details: err.message });
  }
});

// GET /api/cities/:id
router.get('/:id', async (req, res) => {
  try {
    const city = await City.findById(req.params.id);
    if (!city) return res.status(404).json({ error: 'Not found' });
    return res.json(city);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid id', details: err.message });
  }
});

// POST /api/cities (только админ)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    const city = await City.create({ name, code });
    return res.status(201).json(city);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'City name or code already exists' });
    }
    return res.status(500).json({ error: 'Failed to create city', details: err.message });
  }
});

// PATCH /api/cities/:id (только админ)
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const city = await City.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!city) return res.status(404).json({ error: 'Not found' });
    return res.json(city);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update city', details: err.message });
  }
});

// DELETE /api/cities/:id (только админ)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const city = await City.findByIdAndDelete(req.params.id);
    if (!city) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'City deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete city', details: err.message });
  }
});

module.exports = router;

