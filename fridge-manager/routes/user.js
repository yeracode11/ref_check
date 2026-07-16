const express = require('express');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const USER_ROLES = ['manager', 'admin', 'accountant', 'service_manager', 'sales_head'];

router.use(authenticateToken, requireAdmin);

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const { role, active } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (active !== undefined) filter.active = active === 'true';
    const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch users', details: err.message });
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Not found' });
    return res.json(user);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid id', details: err.message });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  try {
    const { username, password, role, fullName, phone, cityId, active } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (role && !USER_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Некорректная роль. Допустимые: ${USER_ROLES.join(', ')}`,
      });
    }
    const user = await User.create({
      username,
      password,
      role: role || 'manager',
      fullName,
      phone,
      cityId: cityId || null,
      active: active !== false,
    });
    const userObj = user.toObject();
    delete userObj.password;
    return res.status(201).json(userObj);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    return res.status(500).json({ error: 'Failed to create user', details: err.message });
  }
});

// PATCH /api/users/:id
router.patch('/:id', async (req, res) => {
  try {
    const { username, password, role, fullName, phone, cityId, active } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Нельзя редактировать свой аккаунт через этот интерфейс' });
    }

    if (username !== undefined) user.username = username;
    if (role !== undefined) {
      if (!USER_ROLES.includes(role)) {
        return res.status(400).json({
          error: `Некорректная роль. Допустимые: ${USER_ROLES.join(', ')}`,
        });
      }
      user.role = role;
    }
    if (fullName !== undefined) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (cityId !== undefined) user.cityId = cityId || null;
    if (active !== undefined) user.active = active;
    if (password && password.length >= 6) {
      user.password = password;
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;
    return res.json(userObj);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    return res.status(500).json({ error: 'Failed to update user', details: err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
    }

    await User.findByIdAndDelete(req.params.id);
    return res.json({ message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
});

module.exports = router;
