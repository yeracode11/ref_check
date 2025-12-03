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
    fridgeId: { type: String, required: true, index: true },
    photos: { type: [String], default: [] },
    location: { type: GeoPointSchema, index: '2dsphere', required: true },
    address: { type: String },
    notes: { type: String },
    visitedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

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

