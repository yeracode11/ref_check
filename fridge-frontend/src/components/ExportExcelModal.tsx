import { useState } from 'react';
import {
  DEFAULT_EXPORT_PERIOD,
  EXPORT_PERIOD_OPTIONS,
  type ExportPeriod,
} from '../utils/exportPeriod';

type ExportExcelModalProps = {
  open: boolean;
  onClose: () => void;
  onExport: (period: ExportPeriod) => Promise<void>;
  exporting: boolean;
  title?: string;
};

export default function ExportExcelModal({
  open,
  onClose,
  onExport,
  exporting,
  title = 'Экспорт в Excel',
}: ExportExcelModalProps) {
  const [period, setPeriod] = useState<ExportPeriod>(DEFAULT_EXPORT_PERIOD);

  if (!open) return null;

  const selected = EXPORT_PERIOD_OPTIONS.find((o) => o.value === period);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-excel-title"
      >
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 id="export-excel-title" className="text-lg font-semibold text-slate-900">
            {title}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Выберите период для листов «Отметки ТП» и «История ремонтов». Справочник холодильников — полный.
          </p>
        </div>

        <div className="px-6 py-4 space-y-2">
          {EXPORT_PERIOD_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                period === option.value
                  ? 'border-green-500 bg-green-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="exportPeriod"
                value={option.value}
                checked={period === option.value}
                onChange={() => setPeriod(option.value)}
                className="mt-1"
                disabled={exporting}
              />
              <span>
                <span className="block font-medium text-slate-900">{option.label}</span>
                <span className="block text-sm text-slate-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {selected?.value === 'all' && (
          <p className="px-6 pb-2 text-sm text-amber-700">
            Полный экспорт нагружает сервер — для больших городов может занять до 15 минут.
          </p>
        )}

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => onExport(period)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            {exporting ? 'Формирование…' : 'Скачать Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}
