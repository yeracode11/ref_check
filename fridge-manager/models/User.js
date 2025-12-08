const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, sparse: true, index: true }, // необязательное поле
    password: { type: String, required: true },
    role: { type: String, enum: ['manager', 'admin', 'accountant'], default: 'manager', index: true },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City', index: true }, // Город бухгалтера
    fullName: { type: String },
    phone: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('User', UserSchema);

