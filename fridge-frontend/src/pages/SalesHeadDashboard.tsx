import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge } from '../components/ui/Card';
import { LoadingSpinner } from '../components/ui/Loading';
import { FridgeDetailModal } from '../components/FridgeDetailModal';
import {
  getEquipmentIndicator,
  getEquipmentStatusLabel,
  getEquipmentIndicatorClasses,
  EquipmentStatus,
} from '../utils/fridgeUtils';

type City = { _id: string; name: string; code: string };

type SalesFridge = {
  _id: string;
  code: string;
  number?: string;
  name: string;
  address?: string;
  status?: EquipmentStatus;
  cityId?: City;
  equipmentIndicator?: string;
  isComplexRepair?: boolean;
};

type CheckinRow = {
  id: number;
  managerUsername?: string;
  managerFullName?: string;
  managerRole?: string;
  fridgeId: string;
  visitedAt: string;
  fridgeCondition?: string;
  isSeasonalClosure?: boolean;
  notes?: string;
};

type AnalyticsData = {
  dailyStats: { date: string; breakdowns: number; repairs: number; costKzt: number }[];
  statusCounts: { working: number; broken: number; under_repair: number };
  topParts: { part: string; count: number; estimatedCostKzt: number }[];
  summary: {
    totalFridges: number;
    faultyFridges: number;
    totalRepairs: number;
    totalRepairCostKzt: number;
    breakdownReports: number;
    days: number;
  };
  cities: City[];
};

const PIE_COLORS = ['#2563eb', '#9333ea', '#ea580c'];

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(kzt: number) {
  return new Intl.NumberFormat('ru-RU').format(kzt) + ' ₸';
}

export default function SalesHeadDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSalesHead = user?.role === 'sales_head';
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCityId, setSelectedCityId] = useState('all');
  const [cityName, setCityName] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [fridges, setFridges] = useState<SalesFridge[]>([]);
  const [checkins, setCheckins] = useState<CheckinRow[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loadingFridges, setLoadingFridges] = useState(true);
  const [loadingCheckins, setLoadingCheckins] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFridgeId, setSelectedFridgeId] = useState<string | null>(null);
  const [days, setDays] = useState(90);

  useEffect(() => {
    api.get('/api/cities?active=true')
      .then((res) => {
        setCities(res.data);
        if (isSalesHead && user?.cityId) {
          const city = res.data.find((c: City) => c._id === user.cityId);
          if (city) {
            setSelectedCityId(city._id);
            setCityName(city.name);
          }
        }
      })
      .catch(() => {});
  }, [isSalesHead, user?.cityId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingFridges(true);
        const params = new URLSearchParams({ limit: '200' });
        if (selectedCityId !== 'all') params.append('cityId', selectedCityId);
        if (equipmentFilter === 'faulty') params.append('equipmentStatus', 'faulty');
        else if (equipmentFilter !== 'all') params.append('equipmentStatus', equipmentFilter);
        if (search.trim()) params.append('search', search.trim());
        const res = await api.get(`/api/sales/fridges?${params.toString()}`);
        if (!alive) return;
        setFridges(res.data?.data || []);
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.error || e.message);
      } finally {
        if (alive) setLoadingFridges(false);
      }
    })();
    return () => { alive = false; };
  }, [selectedCityId, equipmentFilter, search]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingCheckins(true);
        const params = new URLSearchParams({ limit: '50' });
        if (selectedCityId !== 'all') params.append('cityId', selectedCityId);
        const res = await api.get(`/api/sales/checkins?${params.toString()}`);
        if (!alive) return;
        setCheckins(res.data?.data || []);
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.error || e.message);
      } finally {
        if (alive) setLoadingCheckins(false);
      }
    })();
    return () => { alive = false; };
  }, [selectedCityId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingAnalytics(true);
        const params = new URLSearchParams({ days: String(days) });
        if (selectedCityId !== 'all') params.append('cityId', selectedCityId);
        const res = await api.get(`/api/sales/analytics?${params.toString()}`);
        if (!alive) return;
        setAnalytics(res.data);
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.error || e.message);
      } finally {
        if (alive) setLoadingAnalytics(false);
      }
    })();
    return () => { alive = false; };
  }, [selectedCityId, days]);

  const statusPie = analytics
    ? [
        { name: 'Исправные', value: analytics.statusCounts.working },
        { name: 'Сломанные', value: analytics.statusCounts.broken },
        { name: 'На ремонте', value: analytics.statusCounts.under_repair },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Режим просмотра для НОП</h1>
        <p className="text-slate-500 mt-1">
          {isSalesHead && cityName
            ? `Мониторинг по городу: ${cityName}`
            : 'Мониторинг неисправного оборудования, отметок ТП/МХО и аналитика затрат на ремонт'}
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700 text-sm">{error}</Card>
      )}

      <Card className="bg-slate-50">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Город</label>
            {isSalesHead ? (
              <div className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 font-medium">
                📍 {cityName || 'Город не назначен'}
              </div>
            ) : (
              <select
                value={selectedCityId}
                onChange={(e) => setSelectedCityId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="all">Все города</option>
                {cities.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Состояние</label>
            <select
              value={equipmentFilter}
              onChange={(e) => setEquipmentFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="all">Все</option>
              <option value="faulty">Неисправные</option>
              <option value="broken">Сломанные</option>
              <option value="under_repair">На ремонте</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Поиск</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Название, код, адрес..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Период аналитики</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
              <option value={180}>180 дней</option>
            </select>
          </div>
        </div>
      </Card>

      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><div className="text-sm text-slate-500">Всего холодильников</div><div className="text-2xl font-bold">{analytics.summary.totalFridges}</div></Card>
          <Card><div className="text-sm text-slate-500">Неисправные</div><div className="text-2xl font-bold text-orange-600">{analytics.summary.faultyFridges}</div></Card>
          <Card><div className="text-sm text-slate-500">Ремонтов за период</div><div className="text-2xl font-bold">{analytics.summary.totalRepairs}</div></Card>
          <Card><div className="text-sm text-slate-500">Оценка затрат</div><div className="text-xl font-bold">{formatMoney(analytics.summary.totalRepairCostKzt)}</div></Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="font-semibold text-slate-900 mb-4">Динамика поломок и ремонтов</h2>
          {loadingAnalytics ? (
            <div className="flex justify-center py-12"><LoadingSpinner /></div>
          ) : analytics ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={analytics.dailyStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="breakdowns" name="Поломки (ТП)" stroke="#9333ea" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="repairs" name="Ремонты (МХО)" stroke="#ea580c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : null}
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900 mb-4">Затраты на ремонт по дням (₸)</h2>
          {loadingAnalytics ? (
            <div className="flex justify-center py-12"><LoadingSpinner /></div>
          ) : analytics ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.dailyStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} />
                <YAxis />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="costKzt" name="Затраты" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          ) : null}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="font-semibold text-slate-900 mb-4">Распределение по состоянию</h2>
          {analytics && (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusPie.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold text-slate-900 mb-4">Топ заменённых деталей</h2>
          {analytics?.topParts?.length ? (
            <div className="space-y-2 max-h-[240px] overflow-y-auto">
              {analytics.topParts.map((p) => (
                <div key={p.part} className="flex justify-between text-sm border-b border-slate-100 pb-2">
                  <span>{p.part} <span className="text-slate-400">×{p.count}</span></span>
                  <span className="font-medium">{formatMoney(p.estimatedCostKzt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Нет данных за выбранный период</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-4">Холодильники</h2>
        {loadingFridges ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : fridges.length === 0 ? (
          <p className="text-sm text-slate-500">Нет холодильников по выбранным фильтрам</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2 pr-4">Название</th>
                  <th className="py-2 pr-4">Код</th>
                  <th className="py-2 pr-4">Город</th>
                  <th className="py-2 pr-4">Состояние</th>
                  <th className="py-2">Адрес</th>
                </tr>
              </thead>
              <tbody>
                {fridges.map((f) => (
                  <tr
                    key={f._id}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelectedFridgeId(f._id)}
                  >
                    <td className="py-2 pr-4 font-medium">{f.name}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{f.number || f.code}</td>
                    <td className="py-2 pr-4">{f.cityId?.name || '—'}</td>
                    <td className="py-2 pr-4">
                      <Badge className={getEquipmentIndicatorClasses(getEquipmentIndicator(f.status))}>
                        {getEquipmentStatusLabel(f.status)}
                        {f.isComplexRepair ? ' (сложный)' : ''}
                      </Badge>
                    </td>
                    <td className="py-2 text-slate-600 truncate max-w-[200px]">{f.address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-4">Последние отметки ТП и МХО</h2>
        {loadingCheckins ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : checkins.length === 0 ? (
          <p className="text-sm text-slate-500">Нет отметок</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {checkins.map((c) => (
              <div key={c.id} className="flex flex-wrap gap-2 justify-between text-sm border-b border-slate-100 pb-2">
                <div>
                  <span className="font-medium">{c.managerFullName || c.managerUsername}</span>
                  {c.managerRole && <span className="text-slate-400 ml-1">({c.managerRole})</span>}
                  <span className="text-slate-400 ml-2">{formatDate(c.visitedAt)}</span>
                </div>
                <div className="text-slate-600">
                  Холодильник: {c.fridgeId}
                  {c.fridgeCondition === 'broken' && <Badge className="ml-2 bg-purple-100 text-purple-700">Сломан</Badge>}
                  {c.isSeasonalClosure && <Badge className="ml-2 bg-amber-100 text-amber-800">Закрыт</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {selectedFridgeId && (
        <FridgeDetailModal
          fridgeId={selectedFridgeId}
          onClose={() => setSelectedFridgeId(null)}
        />
      )}
    </div>
  );
}
