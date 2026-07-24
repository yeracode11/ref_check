const mongoose = require('mongoose');

const GeoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
      required: true,
    },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false }
);

const CheckinSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true, index: true, required: true },
    managerId: { type: String, required: true, index: true },
    fridgeId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    /** Ссылка на Fridge — однозначная привязка к городу (новые отметки) */
    fridgeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Fridge', index: true },
    photos: { type: [String], default: [] },
    location: { type: GeoPointSchema, index: '2dsphere', required: true },
    address: { type: String },
    notes: { type: String },
    visitedAt: { type: Date, default: Date.now, index: true },
    // Состояние холодильника по отметке ТП
    fridgeCondition: {
      type: String,
      enum: ['working', 'broken'],
      default: 'working',
    },
    // Флаг закрытия объекта (школа / режимный объект)
    isSeasonalClosure: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CheckinSchema.index({ fridgeId: 1, visitedAt: -1 });
CheckinSchema.index({ fridgeRef: 1, visitedAt: -1 });

// Remove _id from JSON output, use id instead
CheckinSchema.set('toJSON', {
  transform: function (doc, ret) {
    ret.id = ret.id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Checkin', CheckinSchema);

