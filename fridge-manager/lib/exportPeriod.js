/**
 * Период выборки для Excel-экспорта (снижает нагрузку на сервер).
 *
 * Query: period=week | month | 6months | all
 */

const EXPORT_PERIOD_PRESETS = {
  week: { days: 7, label: 'неделя', fileSuffix: '7д' },
  month: { days: 30, label: 'месяц', fileSuffix: '30д' },
  '6months': { days: 180, label: '6мес', fileSuffix: '180д' },
  all: { days: null, label: 'все', fileSuffix: 'все' },
};

const DEFAULT_EXPORT_PERIOD = 'month';

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseExportPeriod(value) {
  const raw = value == null || String(value).trim() === ''
    ? DEFAULT_EXPORT_PERIOD
    : String(value).trim().toLowerCase();

  const preset = EXPORT_PERIOD_PRESETS[raw] || EXPORT_PERIOD_PRESETS[DEFAULT_EXPORT_PERIOD];
  const since = preset.days
    ? startOfUtcDay(new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000))
    : null;

  return {
    key: EXPORT_PERIOD_PRESETS[raw] ? raw : DEFAULT_EXPORT_PERIOD,
    label: preset.label,
    fileSuffix: preset.fileSuffix,
    days: preset.days,
    since,
  };
}

module.exports = {
  EXPORT_PERIOD_PRESETS,
  DEFAULT_EXPORT_PERIOD,
  parseExportPeriod,
};
