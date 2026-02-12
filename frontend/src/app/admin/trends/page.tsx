'use client';

import { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useProperties } from '@/hooks/useProperties';
import { useInventoryItems } from '@/hooks/useInventory';
import { useItemTrends } from '@/hooks/useItemTrends';
import type { InventoryItem } from '@/types';

interface ChartDataPoint {
  date: string;
  label: string;
  stock?: number;
  requested?: number;
  approved?: number;
  received?: number;
  orderNumber?: string;
  status?: string;
}

function buildChartData(data: ReturnType<typeof useItemTrends>['data']): ChartDataPoint[] {
  if (!data) return [];

  const map = new Map<string, ChartDataPoint>();

  // Add count points (inventory stock levels)
  for (const cp of data.count_points) {
    const dateKey = cp.date.slice(0, 10); // YYYY-MM-DD
    const existing = map.get(dateKey);
    if (existing) {
      existing.stock = cp.quantity;
    } else {
      map.set(dateKey, {
        date: dateKey,
        label: formatDate(dateKey),
        stock: cp.quantity,
      });
    }
  }

  // Add order points
  for (const op of data.order_points) {
    const dateKey = op.date.slice(0, 10);
    const existing = map.get(dateKey);
    if (existing) {
      // Sum quantities if multiple orders on the same date
      existing.requested = (existing.requested || 0) + op.requested_qty;
      existing.approved = (existing.approved || 0) + (op.approved_qty || 0);
      existing.received = (existing.received || 0) + (op.received_qty || 0);
      if (op.order_number) {
        existing.orderNumber = existing.orderNumber
          ? `${existing.orderNumber}, ${op.order_number}`
          : op.order_number;
      }
      existing.status = op.status || existing.status;
    } else {
      map.set(dateKey, {
        date: dateKey,
        label: formatDate(dateKey),
        requested: op.requested_qty,
        approved: op.approved_qty || undefined,
        received: op.received_qty || undefined,
        orderNumber: op.order_number || undefined,
        status: op.status || undefined,
      });
    }
  }

  // Sort by date
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {entry.value != null ? Number(entry.value).toFixed(1) : '-'}
        </p>
      ))}
      {payload[0]?.payload?.orderNumber && (
        <p className="text-gray-500 mt-1 text-xs">Order: {payload[0].payload.orderNumber}</p>
      )}
    </div>
  );
}

export default function ItemTrendsPage() {
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>();
  const [selectedItemId, setSelectedItemId] = useState<number | undefined>();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: properties, isLoading: propsLoading } = useProperties();
  const { data: items, isLoading: itemsLoading } = useInventoryItems(selectedPropertyId);
  const { data: trendsData, isLoading: trendsLoading } = useItemTrends(selectedItemId);

  const chartData = useMemo(() => buildChartData(trendsData), [trendsData]);

  // Filter items by search term
  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!searchTerm) return items;
    const lower = searchTerm.toLowerCase();
    return items.filter((item: InventoryItem) =>
      item.name.toLowerCase().includes(lower) ||
      (item.category && item.category.toLowerCase().includes(lower))
    );
  }, [items, searchTerm]);

  const hasData = chartData.length > 0;

  return (
    <RoleGuard allowedRoles={['admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <TrendingUp className="h-7 w-7 text-primary-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Item Trends</h1>
              <p className="text-sm text-gray-500">
                Visualize inventory levels and order quantities over time
              </p>
            </div>
          </div>

          {/* Selectors */}
          <div className="bg-white rounded-lg shadow p-4 space-y-4 sm:space-y-0 sm:flex sm:items-end sm:gap-4">
            {/* Property selector */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Property
              </label>
              <select
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                value={selectedPropertyId || ''}
                onChange={(e) => {
                  setSelectedPropertyId(e.target.value ? Number(e.target.value) : undefined);
                  setSelectedItemId(undefined);
                  setSearchTerm('');
                }}
              >
                <option value="">Select a property...</option>
                {properties?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Item selector with search */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Item
              </label>
              {selectedPropertyId ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    placeholder="Search items..."
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <select
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                    size={Math.min(8, Math.max(3, filteredItems.length))}
                    value={selectedItemId || ''}
                    onChange={(e) => {
                      setSelectedItemId(e.target.value ? Number(e.target.value) : undefined);
                    }}
                  >
                    {itemsLoading ? (
                      <option disabled>Loading items...</option>
                    ) : filteredItems.length === 0 ? (
                      <option disabled>No items found</option>
                    ) : (
                      filteredItems.map((item: InventoryItem) => (
                        <option key={item.id} value={item.id}>
                          {item.name} {item.category ? `(${item.category})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              ) : (
                <select disabled className="w-full rounded-md border-gray-300 shadow-sm text-sm bg-gray-50">
                  <option>Select a property first...</option>
                </select>
              )}
            </div>
          </div>

          {/* Summary Cards */}
          {trendsData && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <p className="text-sm text-gray-500">Current Stock</p>
                <p className="text-2xl font-bold text-gray-900">
                  {trendsData.current_stock ?? '-'}
                </p>
                {trendsData.unit && (
                  <p className="text-xs text-gray-400">{trendsData.unit}</p>
                )}
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <p className="text-sm text-gray-500">Par Level</p>
                <p className="text-2xl font-bold text-green-600">
                  {trendsData.par_level ?? '-'}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <p className="text-sm text-gray-500">Order At</p>
                <p className="text-2xl font-bold text-red-600">
                  {trendsData.order_at ?? '-'}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <p className="text-sm text-gray-500">Avg Weekly Usage</p>
                <p className="text-2xl font-bold text-blue-600">
                  {trendsData.avg_weekly_usage != null
                    ? trendsData.avg_weekly_usage.toFixed(1)
                    : '-'}
                </p>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-white rounded-lg shadow p-4">
            {!selectedItemId ? (
              <div className="flex items-center justify-center h-80 text-gray-400">
                <p>Select a property and item to view trends</p>
              </div>
            ) : trendsLoading ? (
              <div className="flex items-center justify-center h-80 text-gray-400">
                <p>Loading trend data...</p>
              </div>
            ) : !hasData ? (
              <div className="flex items-center justify-center h-80 text-gray-400">
                <p>No trend data available for this item</p>
              </div>
            ) : (
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  {trendsData?.item_name} &mdash; {trendsData?.property_name}
                </h3>
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />

                    {/* Reference lines for par level and order-at */}
                    {trendsData?.par_level != null && (
                      <ReferenceLine
                        y={trendsData.par_level}
                        stroke="#16a34a"
                        strokeDasharray="5 5"
                        label={{ value: 'Par', position: 'right', fontSize: 11, fill: '#16a34a' }}
                      />
                    )}
                    {trendsData?.order_at != null && (
                      <ReferenceLine
                        y={trendsData.order_at}
                        stroke="#dc2626"
                        strokeDasharray="5 5"
                        label={{ value: 'Order At', position: 'right', fontSize: 11, fill: '#dc2626' }}
                      />
                    )}

                    {/* Stock level line */}
                    <Line
                      type="monotone"
                      dataKey="stock"
                      name="Stock Level"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      connectNulls
                    />

                    {/* Order quantity bars */}
                    <Bar
                      dataKey="requested"
                      name="Requested"
                      fill="#f59e0b"
                      opacity={0.7}
                      barSize={16}
                    />
                    <Bar
                      dataKey="approved"
                      name="Approved"
                      fill="#22c55e"
                      opacity={0.7}
                      barSize={16}
                    />
                    <Bar
                      dataKey="received"
                      name="Received"
                      fill="#6366f1"
                      opacity={0.7}
                      barSize={16}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
