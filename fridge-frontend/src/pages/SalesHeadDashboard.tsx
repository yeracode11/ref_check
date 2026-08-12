import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';
import { QRCode } from '../components/ui/QRCode';
import { FridgeDetailModal } from '../components/FridgeDetailModal';
import { AnalyticsPanel } from '../components/admin/AnalyticsPanel';
import { AdminFridgeMap } from '../components/admin/AdminFridgeMap';
import { RepairWorksList } from '../components/RepairWorksList';
import {
  getDisplayIdentifier,
  getEquipmentIndicator,
  getEquipmentStatusLabel,
  getEquipmentIndicatorClasses,
  EquipmentStatus,
} from '../utils/fridgeUtils';
import { resolveUserCityId } from '../utils/userCityId';

type City = { _id: string; name: string; code: string };

type Fridge = {
  _id: string;
  code: string;
  number?: string;
  name: string;
  address?: string;
  cityId?: City | null;
  warehouseStatus: 'warehouse' | 'installed' | 'returned' | 'moved';
  status?: EquipmentStatus;
  isSeasonalClosure?: boolean;
  clientInfo?: { name?: string; inn?: string; contractNumber?: string; contactPhone?: string } | null;
};

type ActivityCheckin = {
  type: 'checkin';
  id: number;
  at: string;
  actorFullName?: string;
  actorUsername?: string;
  fridgeId: string;
  fridgeName?: string;
  fridgeCondition?: string;
  isSeasonalClosure?: boolean;
  notes?: string;
};

type ActivityRepair = {
  type: 'repair';
  id: string;
  at: string;
  actorFullName?: string;
  actorUsername?: string;
  fridgeId: string;
  fridgeName?: string;
  completedWorks?: string[];
  workType?: string;
  comment?: string;
  status: 'in_progress' | 'completed';
  isComplexRepair?: boolean;
};

type ActivityRow = ActivityCheckin | ActivityRepair;

type RepairSummary = {
  faultyFridges: number;
  totalRepairs: number;
  totalCheckins: number;
  breakdownReports: number;
};

const ITEMS_PER_PAGE = 30;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getWarehouseBadge(status: string) {
  switch (status) {
    case 'warehouse':
      return <Badge className="bg-blue-100 text-blue-700">На складе</Badge>;
    case 'installed':
      return <Badge className="bg-green-100 text-green-700">Установлен</Badge>;
    case 'returned':
      return <Badge className="bg-red-100 text-red-700">Возврат</Badge>;
    case 'moved':
      return <Badge className="bg-gray-900 text-white">Перемещен</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-700">{status}</Badge>;
  }
}

export default function SalesHeadDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const isSalesHead = user?.role === 'sales_head';
  const assignedCityId = resolveUserCityId(user?.cityId);

  const [cities, setCities] = useState<City[]>([]);
  const [cityName, setCityName] = useState('');
  const [selectedCityId, setSelectedCityId] = useState('');
  const mapCityId = isAdmin ? selectedCityId : assignedCityId;

  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalFridges, setTotalFridges] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [equipmentFilter, setEquipmentFilter] = useState('all');

  const [mapRefreshKey, setMapRefreshKey] = useState(0);

  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [activityFilter, setActivityFilter] = useState<'all' | 'checkin' | 'repair'>('all');
  const [repairSummary, setRepairSummary] = useState<RepairSummary | null>(null);

  const [exporting, setExporting] = useState(false);
  const [selectedFridgeDetailId, setSelectedFridgeDetailId] = useState<string | null>(null);
  const [selectedQRFridge, setSelectedQRFridge] = useState<Fridge | null>(null);

  const observerTarget = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (user && user.role !== 'sales_head' && user.role !== 'admin') {
      navigate('/fridges', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;
    if (isSalesHead && assignedCityId) {
      api.get(`/api/cities/${assignedCityId}`)
        .then((res) => {
          setCities([res.data]);
          setCityName(res.data.name);
          setSelectedCityId(res.data._id);
        })
        .catch(console.error);
    } else if (isAdmin) {
      api.get('/api/cities?active=true')
        .then((res) => setCities(res.data))
        .catch(console.error);
    }
  }, [user, isSalesHead, isAdmin]);

  const loadFridges = useCallback(async (skip = 0, reset = false) => {
    if (!user) return;
    if (isAdmin && !selectedCityId) {
      setFridges([]);
      setTotalFridges(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    try {
      if (skip === 0) setLoading(true);
      else setLoadingMore(true);

      const params = new URLSearchParams();
      params.append('limit', String(ITEMS_PER_PAGE));
      params.append('skip', String(skip));
      params.append('simple', '1');
      if (search) params.append('search', search);
      if (statusFilter !== 'all') params.append('warehouseStatus', statusFilter);
      if (equipmentFilter === 'faulty') params.append('equipmentStatus', 'faulty');
      else if (equipmentFilter !== 'all') params.append('equipmentStatus', equipmentFilter);
      if (isAdmin && selectedCityId) params.append('cityId', selectedCityId);

      const res = await api.get(`/api/fridges?${params.toString()}`);
      const data = res.data.data || res.data;
      const pagination = res.data.pagination;

      if (reset) setFridges(data);
      else setFridges((prev) => [...prev, ...data]);

      if (pagination) {
        setTotalFridges(pagination.total);
        setHasMore(pagination.hasMore);
      } else {
        setTotalFridges(data.length);
        setHasMore(false);
      }
    } catch (e) {
      console.error('Ошибка загрузки холодильников:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user, search, statusFilter, equipmentFilter, isAdmin, selectedCityId]);

  useEffect(() => {
    loadFridges(0, true);
  }, [loadFridges]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadFridges(fridges.length, false);
        }
      },
      { threshold: 0.1 },
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, fridges.length, loadFridges]);

  useEffect(() => {
    if (isAdmin && !selectedCityId) {
      setActivity([]);
      setRepairSummary(null);
      setLoadingActivity(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLoadingActivity(true);
        const params = new URLSearchParams({ limit: '50' });
        if (isAdmin && selectedCityId) params.append('cityId', selectedCityId);
        const [activityRes, analyticsRes] = await Promise.all([
          api.get(`/api/sales/activity?${params.toString()}`),
          api.get(`/api/sales/analytics?${params.toString()}&days=30`),
        ]);
        if (!alive) return;
        setActivity(activityRes.data?.data || []);
        setRepairSummary({
          faultyFridges: analyticsRes.data?.summary?.faultyFridges || 0,
          totalRepairs: analyticsRes.data?.summary?.totalRepairs || 0,
          totalCheckins: analyticsRes.data?.summary?.totalCheckins || 0,
          breakdownReports: analyticsRes.data?.summary?.breakdownReports || 0,
        });
      } catch (e) {
        console.error('Ошибка загрузки активности:', e);
      } finally {
        if (alive) setLoadingActivity(false);
      }
    })();
    return () => { alive = false; };
  }, [isAdmin, selectedCityId]);

  const handleExportReport = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({ geocode: 'false' });
      if (isAdmin && selectedCityId) params.append('cityId', selectedCityId);
      if (equipmentFilter !== 'all') params.append('equipmentStatus', equipmentFilter);
      if (search.trim()) params.append('search', search.trim());

      const response = await api.get(`/api/admin/export-fridges?${params.toString()}`, {
        responseType: 'blob',
        timeout: 300000,
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = response.headers['content-disposition'];
      let fileName = 'холодильники.xlsx';
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
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Ошибка при экспорте');
    } finally {
      setExporting(false);
    }
  };

  const filteredActivity = activity.filter((row) => {
    if (activityFilter === 'all') return true;
    return row.type === activityFilter;
  });
  const checkinCount = activity.filter((r) => r.type === 'checkin').length;
  const repairCount = activity.filter((r) => r.type === 'repair').length;

  if (!user || (user.role !== 'sales_head' && user.role !== 'admin')) {
    return (
      <Card>
        <p className="text-red-600">Доступ запрещён. Только для НОП и администраторов.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Мониторинг региона</h1>
          <p className="text-slate-500 mt-1">
            {isSalesHead && cityName
              ? `Отметки ТП, ремонты МХО и состояние фонда — ${cityName}`
              : 'Отметки ТП, ремонты МХО и состояние фонда по городу'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportReport}
          disabled={exporting || (isAdmin && !selectedCityId)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium shadow-sm"
        >
          {exporting ? 'Экспорт...' : 'Экспорт в Excel'}
        </button>
      </div>

      {isAdmin && (
        <Card className="bg-slate-50">
          <label className="block text-sm font-medium text-slate-700 mb-1">Город для просмотра</label>
          <select
            value={selectedCityId}
            onChange={(e) => setSelectedCityId(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">Выберите город</option>
            {cities.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </Card>
      )}

      {isSalesHead && cityName && (
        <Card className="bg-blue-50 border-blue-200">
          <p className="text-sm text-blue-900 font-medium">📍 Город: {cityName}</p>
        </Card>
      )}

      <AnalyticsPanel
        endpoint="/api/admin/analytics/accountant"
        fixedCityId={isSalesHead ? assignedCityId : (selectedCityId || undefined)}
        hideManagerStats
        lazy
      />

      {repairSummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="text-center">
            <p className="text-3xl font-bold text-orange-600">{repairSummary.faultyFridges}</p>
            <p className="text-sm text-slate-500">Неисправных сейчас</p>
          </Card>
          <Card className="text-center">
            <p className="text-3xl font-bold text-purple-600">{repairSummary.breakdownReports}</p>
            <p className="text-sm text-slate-500">Поломок за 30 дн.</p>
          </Card>
          <Card className="text-center">
            <p className="text-3xl font-bold text-orange-700">{repairSummary.totalRepairs}</p>
            <p className="text-sm text-slate-500">Ремонтов МХО за 30 дн.</p>
          </Card>
        </div>
      )}

      <Card>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Карта холодильников
          {cityName && <span className="text-blue-600 ml-2 font-normal">— {cityName}</span>}
        </h2>
        <AdminFridgeMap
          key={`${mapCityId}-${mapRefreshKey}`}
          cityId={mapCityId}
          cityName={cityName}
          cityCode={cities.find((c) => c._id === mapCityId)?.code}
        />
      </Card>

      <Card>
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Поиск по названию, номеру, адресу..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Все статусы склада</option>
            <option value="warehouse">На складе</option>
            <option value="installed">Установлен</option>
            <option value="returned">Возврат</option>
          </select>
          <select
            value={equipmentFilter}
            onChange={(e) => setEquipmentFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Все состояния</option>
            <option value="faulty">Неисправные</option>
            <option value="broken">Сломанные</option>
            <option value="under_repair">На ремонте</option>
            <option value="working">Исправные</option>
          </select>
        </div>
        <p className="text-xs text-slate-500 mt-2">Найдено: {totalFridges} холодильников</p>
      </Card>

      {loading ? (
        <LoadingCard />
      ) : fridges.length === 0 ? (
        <EmptyState message={isAdmin && !selectedCityId ? 'Выберите город' : 'Холодильники не найдены'} />
      ) : (
        <div className="grid gap-4">
          {fridges.map((f) => (
            <Card key={f._id}>
              <div className="flex flex-wrap gap-4 justify-between">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="font-semibold text-slate-900">{f.name}</span>
                    {getWarehouseBadge(f.warehouseStatus)}
                    <Badge className={getEquipmentIndicatorClasses(getEquipmentIndicator(f.status))}>
                      {getEquipmentStatusLabel(f.status)}
                    </Badge>
                    {f.isSeasonalClosure && (
                      <Badge className="bg-amber-100 text-amber-800">Закрыт временно</Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 space-y-1">
                    {(() => {
                      const displayId = getDisplayIdentifier(
                        { clientInfo: f.clientInfo, number: f.number, code: f.code, name: f.name },
                        f.cityId?.name,
                      );
                      if (!displayId) return null;
                      const isNumberCity = ['Кызылорда', 'Шымкент', 'Талдыкорган'].includes(f.cityId?.name || '');
                      return (
                        <p>
                          <span className="text-slate-500">{isNumberCity ? 'Номер:' : 'Код:'}</span>{' '}
                          {displayId}
                        </p>
                      );
                    })()}
                    {f.address && <p><span className="text-slate-500">Адрес:</span> {f.address}</p>}
                    {f.cityId && <p><span className="text-slate-500">Город:</span> {f.cityId.name}</p>}
                  </div>
                  {f.clientInfo?.name && (
                    <div className="mt-3 p-2 bg-slate-50 rounded-lg text-sm">
                      <p className="font-medium text-slate-700">Клиент: {f.clientInfo.name}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setSelectedFridgeDetailId(f._id)}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                  >
                    Подробнее
                  </button>
                  <button
                    onClick={() => setSelectedQRFridge(f)}
                    className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                  >
                    QR-код
                  </button>
                </div>
              </div>
            </Card>
          ))}
          {hasMore && (
            <div ref={observerTarget} className="py-4 flex justify-center">
              {loadingMore ? <LoadingSpinner size="md" /> : <span className="text-xs text-slate-500">Загрузка...</span>}
            </div>
          )}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Последние отметки ТП и ремонты МХО</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => setActivityFilter('all')}
              className={`px-3 py-1.5 rounded-lg border ${activityFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200'}`}
            >
              Все ({activity.length})
            </button>
            <button
              type="button"
              onClick={() => setActivityFilter('checkin')}
              className={`px-3 py-1.5 rounded-lg border ${activityFilter === 'checkin' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200'}`}
            >
              ТП ({checkinCount})
            </button>
            <button
              type="button"
              onClick={() => setActivityFilter('repair')}
              className={`px-3 py-1.5 rounded-lg border ${activityFilter === 'repair' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white border-slate-200'}`}
            >
              МХО ({repairCount})
            </button>
          </div>
        </div>
        {loadingActivity ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : filteredActivity.length === 0 ? (
          <p className="text-sm text-slate-500">Нет отметок и ремонтов</p>
        ) : (
          <div className="space-y-3 max-h-[480px] overflow-y-auto">
            {filteredActivity.map((row) =>
              row.type === 'checkin' ? (
                <div key={`checkin-${row.id}`} className="text-sm border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-blue-100 text-blue-800">ТП · Отметка</Badge>
                    <span className="font-medium">{row.actorFullName || row.actorUsername}</span>
                    <span className="text-slate-400">{formatDate(row.at)}</span>
                  </div>
                  <div className="mt-1 text-slate-600">
                    Холодильник: {row.fridgeId}
                    {row.fridgeName && <span className="text-slate-400 ml-1">· {row.fridgeName}</span>}
                    {row.fridgeCondition === 'broken' && (
                      <Badge className="ml-2 bg-purple-100 text-purple-700">Сломан</Badge>
                    )}
                    {row.isSeasonalClosure && (
                      <Badge className="ml-2 bg-amber-100 text-amber-800">Закрыт</Badge>
                    )}
                  </div>
                  {row.notes && <p className="text-xs text-slate-500 mt-1 italic">{row.notes}</p>}
                </div>
              ) : (
                <div key={`repair-${row.id}`} className="text-sm border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-orange-100 text-orange-800">МХО · Ремонт</Badge>
                    <span className="font-medium">{row.actorFullName || row.actorUsername}</span>
                    <span className="text-slate-400">{formatDate(row.at)}</span>
                    <Badge className={row.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}>
                      {row.status === 'completed' ? 'Завершён' : 'В работе'}
                    </Badge>
                  </div>
                  <div className="mt-1 text-slate-600">
                    Холодильник: {row.fridgeId}
                    {row.fridgeName && <span className="text-slate-400 ml-1">· {row.fridgeName}</span>}
                  </div>
                  <RepairWorksList completedWorks={row.completedWorks} workType={row.workType} compact />
                  {row.comment && <p className="text-xs text-slate-500 mt-1 italic">Комментарий: {row.comment}</p>}
                </div>
              ),
            )}
          </div>
        )}
      </Card>

      {selectedFridgeDetailId && (
        <FridgeDetailModal
          fridgeId={selectedFridgeDetailId}
          onClose={() => setSelectedFridgeDetailId(null)}
        />
      )}

      {selectedQRFridge && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedQRFridge(null)}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{selectedQRFridge.name}</h3>
            <p className="text-sm text-slate-500 mb-4 font-mono">
              {getDisplayIdentifier(selectedQRFridge, selectedQRFridge.cityId?.name) || selectedQRFridge.code}
            </p>
            <QRCode
              value={`${window.location.origin}/checkin/${encodeURIComponent(
                selectedQRFridge.number || selectedQRFridge.code,
              )}`}
              size={220}
            />
            <button
              onClick={() => setSelectedQRFridge(null)}
              className="mt-4 w-full px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
