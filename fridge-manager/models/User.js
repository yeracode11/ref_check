const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String }, // необязательное поле без индекса
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

// Remove any existing email indexes on startup
UserSchema.post('init', function() {
  const collection = this.db.collection('users');
  collection.indexes((err, indexes) => {
    if (err) return console.error('Error checking indexes:', err);
    indexes.forEach(index => {
      if (index.name.includes('email') && index.name !== '_id_') {
        console.log('Removing old email index:', index.name);
        collection.dropIndex(index.name, (dropErr) => {
          if (dropErr) console.error('Error dropping email index:', dropErr);
          else console.log('Successfully dropped email index:', index.name);
        });
      }
    });
  });
});

module.exports = mongoose.model('User', UserSchema);

