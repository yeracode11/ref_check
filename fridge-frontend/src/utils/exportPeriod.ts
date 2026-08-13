import type { AxiosInstance } from 'axios';

export type ExportPeriod = 'week' | 'month' | '6months' | 'all';

export const EXPORT_PERIOD_OPTIONS: {
  value: ExportPeriod;
  label: string;
  hint: string;
}[] = [
  { value: 'week', label: 'Неделя', hint: 'Отметки и ремонты за 7 дней — быстрее всего' },
  { value: 'month', label: 'Месяц', hint: 'За 30 дней — рекомендуется по умолчанию' },
  { value: '6months', label: '6 месяцев', hint: 'За полгода — для сводного анализа' },
  { value: 'all', label: 'Весь период', hint: 'Вся история — может занять несколько минут' },
];

export const DEFAULT_EXPORT_PERIOD: ExportPeriod = 'month';

export function buildExportQueryParams(
  period: ExportPeriod,
  extra?: Record<string, string | undefined>,
): URLSearchParams {
  const params = new URLSearchParams({ geocode: 'false', period });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value != null && value !== '') params.append(key, value);
    }
  }
  return params;
}

export async function downloadExcelExport(api: AxiosInstance, path: string): Promise<void> {
  const response = await api.get(path, {
    responseType: 'blob',
    timeout: 900000,
  });

  const urlObj = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = urlObj;

  const contentDisposition = response.headers['content-disposition'] as string | undefined;
  let fileName = 'отчет.xlsx';
  if (contentDisposition) {
    const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (fileNameMatch?.[1]) {
      fileName = decodeURIComponent(fileNameMatch[1].replace(/['"]/g, ''));
    }
  }

  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(urlObj);
}
