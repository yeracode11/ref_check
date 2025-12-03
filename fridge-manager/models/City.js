const mongoose = require('mongoose');

const CitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    code: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('City', CitySchema);

