const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', CounterSchema);

async function getMaxCheckinId() {
  const Checkin = require('./Checkin');
  const maxDoc = await Checkin.findOne().sort({ id: -1 }).select('id').lean();
  return maxDoc?.id || 0;
}

/**
 * Счётчик checkin мог отстать от max(checkins.id) после импорта/восстановления БД.
 * Подтягиваем seq до фактического максимума перед выдачей нового id.
 */
async function syncCheckinCounter() {
  const maxId = await getMaxCheckinId();
  const counter = await Counter.findById('checkin').lean();
  if (!counter || counter.seq < maxId) {
    await Counter.findByIdAndUpdate(
      'checkin',
      { $set: { seq: maxId } },
      { upsert: true },
    );
    return maxId;
  }
  return counter.seq;
}

async function getNextSequence(name) {
  if (name === 'checkin') {
    await syncCheckinCounter();
  }

  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return counter.seq;
}

module.exports = {
  Counter,
  getNextSequence,
  syncCheckinCounter,
  getMaxCheckinId,
};
