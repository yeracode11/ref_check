const mongoose = require('mongoose');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
} = require('./fridgeVisitHelpers');
const { canonicalCheckinFridgeId } = require('./fridgeIdFormat');

function normalizeFridgeIdForCompare(id) {
  return String(id ?? '').trim().replace(/^#+/, '');
}

function fridgeIdsEquivalent(a, b) {
  return normalizeFridgeIdForCompare(a) === normalizeFridgeIdForCompare(b);
}

function fridgeIdMatchesCandidates(fridgeId, candidates) {
  const normalized = normalizeFridgeIdForCompare(fridgeId);
  return candidates.some((c) => normalizeFridgeIdForCompare(c) === normalized);
}

function managerIdMatchesCandidates(managerId, candidates) {
  const m = String(managerId ?? '');
  return candidates.some((c) => String(c) === m);
}

/**
 * username и ObjectId одного пользователя — одна сущность для дедупа.
 */
async function resolveManagerIdCandidates(User, managerId) {
  const raw = String(managerId || '').trim();
  const out = new Set();
  if (!raw) return [];

  out.add(raw);
  const or = [{ username: raw }];
  if (mongoose.isValidObjectId(raw)) {
    or.push({ _id: new mongoose.Types.ObjectId(raw) });
  }

  const user = await User.findOne({ $or: or }).select('username _id').lean();
  if (user) {
    if (user.username) out.add(String(user.username));
    out.add(String(user._id));
  }

  return [...out];
}

function buildFridgeIdInQueryForDedupe(fridge, normalizedFridgeId) {
  const ids = fridge
    ? buildCheckinFridgeIdCandidates(fridge)
    : [normalizedFridgeId];
  const expanded = expandCheckinFridgeIdsForInQuery(ids);
  return expanded.length ? { fridgeId: { $in: expanded } } : { fridgeId: normalizedFridgeId };
}

module.exports = {
  normalizeFridgeIdForCompare,
  fridgeIdsEquivalent,
  fridgeIdMatchesCandidates,
  managerIdMatchesCandidates,
  resolveManagerIdCandidates,
  buildFridgeIdInQueryForDedupe,
  canonicalCheckinFridgeId,
};
