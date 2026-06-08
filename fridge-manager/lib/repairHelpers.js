const {
  isComplexMxoWorks,
  estimateMxoWorksCostKzt,
  labelsFromCompletedWorks,
} = require('./mxoRepairWorks');

/** Детали, при замене которых ремонт считается «сложным» */
const COMPLEX_PART_KEYWORDS = [
  'компрессор',
  'compressor',
  'мотор вентилятора',
  'вентилятор',
  'fan motor',
  'дверь',
  'дверца',
  'door',
];

/** Ориентировочная стоимость замены деталей (тенге) для аналитики НОП */
const PART_COST_ESTIMATES_KZT = {
  компрессор: 180000,
  compressor: 180000,
  'мотор вентилятора': 45000,
  вентилятор: 35000,
  'fan motor': 45000,
  дверь: 55000,
  дверца: 55000,
  door: 55000,
  термостат: 15000,
  thermostat: 15000,
  реле: 12000,
  relay: 12000,
};

function normalizePartName(part) {
  return String(part || '').trim().toLowerCase();
}

function repairWorkLabels(repairLike) {
  const fromChecklist = labelsFromCompletedWorks(repairLike?.completedWorks);
  if (fromChecklist.length) return fromChecklist;
  return Array.isArray(repairLike?.replacedParts) ? repairLike.replacedParts : [];
}

function isComplexRepair(replacedParts, completedWorks) {
  if (isComplexMxoWorks(completedWorks)) return true;
  const parts = Array.isArray(replacedParts) ? replacedParts : [];
  if (parts.length === 0) return false;
  return parts.some((part) => {
    const p = normalizePartName(part);
    return COMPLEX_PART_KEYWORDS.some((kw) => p.includes(kw));
  });
}

function isComplexRepairRecord(repairLike) {
  return isComplexRepair(repairLike?.replacedParts, repairLike?.completedWorks);
}

function estimateRepairCostKzt(replacedParts, completedWorks) {
  const checklistCost = estimateMxoWorksCostKzt(completedWorks);
  if (checklistCost > 0) return checklistCost;

  if (!Array.isArray(replacedParts)) return 0;
  let total = 0;
  for (const part of replacedParts) {
    const p = normalizePartName(part);
    let matched = false;
    for (const [key, cost] of Object.entries(PART_COST_ESTIMATES_KZT)) {
      if (p.includes(key)) {
        total += cost;
        matched = true;
        break;
      }
    }
    if (!matched && p) {
      total += 10000;
    }
  }
  return total;
}

function estimateRepairCostRecord(repairLike) {
  return estimateRepairCostKzt(repairLike?.replacedParts, repairLike?.completedWorks);
}

function getEquipmentIndicator(fridge, activeRepair) {
  if (!fridge) return 'blue';
  if (fridge.status === 'broken') return 'purple';
  if (fridge.status === 'under_repair') {
    if (activeRepair && isComplexRepairRecord(activeRepair)) {
      return 'orange';
    }
    return 'blue';
  }
  return 'blue';
}

module.exports = {
  COMPLEX_PART_KEYWORDS,
  PART_COST_ESTIMATES_KZT,
  isComplexRepair,
  isComplexRepairRecord,
  estimateRepairCostKzt,
  estimateRepairCostRecord,
  repairWorkLabels,
  getEquipmentIndicator,
};
