import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../../shared/apiClient';
import { Card } from '../ui/Card';

type DailyCheckin = {
  date: string;
  count: number;
};

type ManagerStat = {
  _id: string;
  username?: string;
  fullName?: string;
  count: number;
  lastVisit: string;
};

type UnvisitedFridge = {
  code: string;
  number?: string;
  name: string;
  address?: string;
  cityId?: { name: string };
  lastVisit: string | null;
  daysSinceVisit: number | null;
};

type AnalyticsData = {
  dailyCheckins: DailyCheckin[];
  managerStats: ManagerStat[];
  topUnvisited: UnvisitedFridge[];
  summary: {
    totalFridges: number;
    totalCheckins: number;
    uniqueManagers: number;
    avgCheckinsPerDay: number;
    withoutCheckinsInPeriod?: number;
    neverVisited?: number;
    fridgesByStatus: {
      warehouse: number;
      installed: number;
      returned: number;
      moved?: number;
    };
  };
};

const COLORS = ['#ff9800', '#4caf50', '#f44336', '#2196f3', '#9c27b0', '#00bcd4'];

function formatShortDate(dateStr: string) {
  const [, month, day] = dateStr.split('-');
  return `${day}.${month}`;
}

type City = {
  _id: string;
  name: string;
  code: string;
};

type AnalyticsPanelProps = {
  endpoint?: string;
  cities?: City[];
  fixedCityId?: string;
  /** Для НОП: скрыть рейтинг менеджеров, показать сводку по непосещённым */
  hideManagerStats?: boolean;
  /** Для бухгалтера и НОП: в сводке показывать установленных, а не отметки за период */
  showInstalledCount?: boolean;
  /** Не грузить данные, пока блок не попадёт во viewport (карта и таблицы — первыми) */
  lazy?: boolean;
};

export function AnalyticsPanel({
  endpoint = '/api/admin/analytics',
  cities = [],
  fixedCityId,
  hideManagerStats = false,
  showInstalledCount = false,
  lazy = false,
}: AnalyticsPanelProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(!lazy);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCityId, setSelectedCityId] = useState<string>('all');
  const effectiveCityId = fixedCityId || (selectedCityId !== 'all' ? selectedCityId : undefined);

  useEffect(() => {
    if (!lazy || visible) return;
    const node = rootRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({ days: days.toString() });
        if (effectiveCityId) {
          params.append('cityId', effectiveCityId);
        }
        const res = await api.get(`${endpoint}?${params.toString()}`);
        if (!alive) return;
        setData(res.data);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Ошибка загрузки аналитики');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [visible, days, endpoint, effectiveCityId]);

  if (!visible) {
    return (
      <div ref={rootRef}>
        <Card>
          <div className="flex justify-center py-12 text-slate-500 text-sm">
            Аналитика загрузится при прокрутке…
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={rootRef}>
        <Card>
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-slate-900"></div>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div ref={rootRef}>
        <Card>
          <div className="text-center py-8 text-red-500">
            <p>⚠️ {error || 'Не удалось загрузить аналитику'}</p>
          </div>
        </Card>
      </div>
    );
  }

  const statusData = [
    { name: 'На складе', value: data.summary.fridgesByStatus.warehouse, color: '#2196F3' },
    { name: 'Установлен', value: data.summary.fridgesByStatus.installed, color: '#4caf50' },
    { name: 'Возврат', value: data.summary.fridgesByStatus.returned, color: '#f44336' },
  ].filter(s => s.value > 0);

  const installedCount = data.summary.fridgesByStatus.installed;

  return (
    <div className="space-y-6">
      {/* Период и фильтры */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-slate-900">📊 Аналитика</h2>
        <div className="flex items-center gap-3">
          {/* Фильтр по городам (только для админа) */}
          {!fixedCityId && cities.length > 0 && (
            <select
              value={selectedCityId}
              onChange={(e) => setSelectedCityId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все города</option>
              {cities.map((city) => (
                <option key={city._id} value={city._id}>
                  {city.name}
                </option>
              ))}
            </select>
          )}
          {/* Фильтр по дням */}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
          </select>
        </div>
      </div>

      {/* Сводка */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="text-center">
          {showInstalledCount ? (
            <>
              <p className="text-3xl font-bold text-green-600">{installedCount}</p>
              <p className="text-sm text-slate-500">Установлено</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-blue-600">{data.summary.totalCheckins}</p>
              <p className="text-sm text-slate-500">Отметок за период</p>
            </>
          )}
        </Card>
        {hideManagerStats ? (
          <>
            <Card className="text-center">
              <p className="text-3xl font-bold text-red-600">{data.summary.withoutCheckinsInPeriod ?? 0}</p>
              <p className="text-sm text-slate-500">Без отметок за период</p>
            </Card>
            <Card className="text-center">
              <p className="text-3xl font-bold text-orange-600">{data.summary.neverVisited ?? 0}</p>
              <p className="text-sm text-slate-500">Никогда не посещались</p>
            </Card>
          </>
        ) : (
          <>
            <Card className="text-center">
              <p className="text-3xl font-bold text-green-600">{data.summary.uniqueManagers}</p>
              <p className="text-sm text-slate-500">Активных менеджеров</p>
            </Card>
            <Card className="text-center">
              <p className="text-3xl font-bold text-orange-600">{data.summary.avgCheckinsPerDay}</p>
              <p className="text-sm text-slate-500">Отметок в день (ср.)</p>
            </Card>
          </>
        )}
        <Card className="text-center">
          <p className="text-3xl font-bold text-slate-700">{data.summary.totalFridges}</p>
          <p className="text-sm text-slate-500">Всего холодильников</p>
        </Card>
      </div>

      {/* Графики */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* График посещений по дням */}
        <Card>
          <h3 className="font-semibold text-slate-900 mb-4">📈 Посещения по дням</h3>
          {data.dailyCheckins.length > 0 ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailyCheckins}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={formatShortDate}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip 
                    labelFormatter={(label) => `Дата: ${label}`}
                    formatter={(value: number) => [value, 'Отметок']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6', r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-400">
              Нет данных за выбранный период
            </div>
          )}
        </Card>

        {/* Статус холодильников */}
        <Card>
          <h3 className="font-semibold text-slate-900 mb-4">🧊 Статус холодильников</h3>
          {statusData.length > 0 ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(value: number) => [value, 'Холодильников']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-400">
              Нет данных
            </div>
          )}
        </Card>
      </div>

      {/* Статистика по менеджерам — только для бухгалтера/админа */}
      {!hideManagerStats && (
      <Card>
        <h3 className="font-semibold text-slate-900 mb-4">👥 Топ менеджеров по отметкам</h3>
        {data.managerStats.length > 0 ? (
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.managerStats.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis 
                  type="category" 
                  dataKey="username" 
                  width={100}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <Tooltip formatter={(value: number) => [value, 'Отметок']} />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-slate-400">
            Нет данных за выбранный период
          </div>
        )}
      </Card>
      )}

      {/* Точки без отметок / давно не посещались */}
      <Card>
        <h3 className="font-semibold text-slate-900 mb-4">
          {hideManagerStats ? '⚠️ Без отметок или давно не посещались' : '⚠️ Давно не посещались'}
        </h3>
        {data.topUnvisited.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 font-medium text-slate-600">Название</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-600">Код</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-600">Адрес</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-600">Последний визит</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-600">Дней</th>
                </tr>
              </thead>
              <tbody>
                {data.topUnvisited.map((f, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium text-slate-900">{f.name}</td>
                    <td className="py-2 px-3 text-slate-500 font-mono">
                      {(f.cityId?.name === 'Шымкент' || f.cityId?.name === 'Кызылорда' || f.cityId?.name === 'Талдыкорган') && f.number ? f.number : `#${f.code}`}
                    </td>
                    <td className="py-2 px-3 text-slate-500 max-w-[200px] truncate">{f.address || '—'}</td>
                    <td className="py-2 px-3 text-right text-slate-500">
                      {f.lastVisit 
                        ? new Date(f.lastVisit).toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' })
                        : <span className="text-red-500 font-medium">Никогда</span>
                      }
                    </td>
                    <td className="py-2 px-3 text-right">
                      {f.daysSinceVisit !== null ? (
                        <span className={`font-medium ${
                          f.daysSinceVisit > 30 ? 'text-red-600' :
                          f.daysSinceVisit > 7 ? 'text-orange-600' :
                          'text-green-600'
                        }`}>
                          {f.daysSinceVisit}
                        </span>
                      ) : (
                        <span className="text-red-600 font-medium">∞</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400">
            Все холодильники посещаются регулярно 🎉
          </div>
        )}
      </Card>
    </div>
  );
}

