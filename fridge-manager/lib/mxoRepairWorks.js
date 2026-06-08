/** Стандартный перечень работ МХО (ремонтник, не ТП) */
const MXO_REPAIR_WORKS = [
  { key: 'led_lamp', label: 'Замена лампы лед 30/120' },
  { key: 'fan_motor_replace', label: 'Замена фан мотора' },
  { key: 'fan_motor_service', label: 'Чистка смазка фан мотора' },
  { key: 'condenser_clean', label: 'Чистка мойка конденсатора EXTRA LARGE/LARGE' },
  { key: 'electric_motor_replace', label: 'Замена Электродвигателя' },
  { key: 'restickering', label: 'Переклейка' },
  { key: 'compressor_replace', label: 'Замена компрессора' },
  { key: 'thermostat_replace', label: 'Замена Термостата' },
  { key: 'refrigerant_leak', label: 'Устроение утечки хладагента /забитый фильтр' },
  { key: 'evaporator_condenser', label: 'Замена испарителя / конденсатора' },
  { key: 'wiring_repair', label: 'Ремонт электро проводки' },
  { key: 'power_cord', label: 'Замена сетевого шнура / вилки' },
  { key: 'microcontroller', label: 'Замена микро контроллера' },
  { key: 'buttons_replace', label: 'Замена кнопок , свет/ сеть .' },
  { key: 'door_adjust', label: 'Регулировка двери' },
  { key: 'door_replace', label: 'Замена двери' },
  { key: 'door_handles', label: 'Ремонт ручек двери' },
  { key: 'painting', label: 'Окраска ХО / полки' },
];

const MXO_WORK_KEYS = new Set(MXO_REPAIR_WORKS.map((w) => w.key));
const MXO_WORK_LABEL_BY_KEY = Object.fromEntries(MXO_REPAIR_WORKS.map((w) => [w.key, w.label]));

/** Сложный ремонт: компрессор, фан мотор, дверь */
const COMPLEX_MXO_WORK_KEYS = new Set([
  'compressor_replace',
  'fan_motor_replace',
  'door_replace',
]);

const MXO_WORK_COST_KZT = {
  led_lamp: 8000,
  fan_motor_replace: 45000,
  fan_motor_service: 12000,
  condenser_clean: 15000,
  electric_motor_replace: 55000,
  restickering: 20000,
  compressor_replace: 180000,
  thermostat_replace: 15000,
  refrigerant_leak: 35000,
  evaporator_condenser: 120000,
  wiring_repair: 18000,
  power_cord: 6000,
  microcontroller: 40000,
  buttons_replace: 10000,
  door_adjust: 15000,
  door_replace: 55000,
  door_handles: 12000,
  painting: 25000,
};

function sanitizeCompletedWorks(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(
    raw.map((k) => String(k).trim()).filter((k) => MXO_WORK_KEYS.has(k)),
  )];
}

function labelsFromCompletedWorks(keys) {
  return keys.map((k) => MXO_WORK_LABEL_BY_KEY[k]).filter(Boolean);
}

function workTypeFromCompletedWorks(keys) {
  const labels = labelsFromCompletedWorks(keys);
  return labels.join('; ');
}

function isComplexMxoWorks(completedWorks) {
  const keys = Array.isArray(completedWorks) ? completedWorks : [];
  return keys.some((k) => COMPLEX_MXO_WORK_KEYS.has(k));
}

function estimateMxoWorksCostKzt(completedWorks) {
  if (!Array.isArray(completedWorks)) return 0;
  return completedWorks.reduce((sum, key) => sum + (MXO_WORK_COST_KZT[key] || 10000), 0);
}

module.exports = {
  MXO_REPAIR_WORKS,
  MXO_WORK_KEYS,
  COMPLEX_MXO_WORK_KEYS,
  sanitizeCompletedWorks,
  labelsFromCompletedWorks,
  workTypeFromCompletedWorks,
  isComplexMxoWorks,
  estimateMxoWorksCostKzt,
};
