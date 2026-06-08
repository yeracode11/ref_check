const mongoose = require('mongoose');

const RepairSchema = new mongoose.Schema(
  {
    fridgeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Fridge',
      required: true,
      index: true,
    },
    repairDate: { type: Date, required: true, default: Date.now },
    workType: { type: String, required: true },
    /** Ключи отмеченных работ из чеклиста МХО */
    completedWorks: { type: [String], default: [] },
    replacedParts: { type: [String], default: [] },
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    comment: { type: String },
    status: {
      type: String,
      enum: ['in_progress', 'completed'],
      default: 'in_progress',
      index: true,
    },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

RepairSchema.index({ fridgeId: 1, repairDate: -1 });

module.exports = mongoose.model('Repair', RepairSchema);
