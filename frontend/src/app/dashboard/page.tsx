'use client';

import { Package, Truck, ClipboardList, AlertTriangle, Users, Building2, Receipt, CheckCircle2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/stores/authStore';
import { useInventoryItems, useLowStockItems } from '@/hooks/useInventory';
import { useMyOrders, usePendingReviewOrders, useOrders } from '@/hooks/useOrders';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useReceipts, useFinancialDashboard } from '@/hooks/useReceipts';
import { useUsers } from '@/hooks/useUsers';
import { useProperties } from '@/hooks/useProperties';
import { formatCurrency } from '@/lib/utils';
import { ROLE_LABELS } from '@/types';
import Link from 'next/link';

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  href,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  href?: string;
}) {
  const content = (
    <div className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

// Admin Dashboard
function AdminDashboard() {
  const { data: users = [] } = useUsers();
  const { data: properties = [] } = useProperties();
  const { data: suppliers = [] } = useSuppliers();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-500 mt-1">System overview and management</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Users" value={users.length} icon={Users} color="bg-blue-500" href="/admin/users" />
        <StatCard title="Properties" value={properties.length} icon={Building2} color="bg-green-500" href="/admin/properties" />
        <StatCard title="Suppliers" value={suppliers.length} icon={Truck} color="bg-purple-500" href="/suppliers" />
        <StatCard title="Active Users" value={users.filter(u => u.is_active).length} icon={CheckCircle2} color="bg-teal-500" />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Users</h2>
        <div className="space-y-3">
          {users.slice(0, 5).map((user) => (
            <div key={user.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
              <div>
                <p className="font-medium text-gray-900">{user.full_name || user.email}</p>
                <p className="text-sm text-gray-500">{ROLE_LABELS[user.role]}</p>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                {user.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Camp Worker Dashboard
function CampWorkerDashboard() {
  const { user } = useAuthStore();
  const { data: inventory = [] } = useInventoryItems(user?.property_id || undefined);
  const { data: lowStock = [] } = useLowStockItems(user?.property_id || undefined);
  const { data: myOrders = [] } = useMyOrders();
  const { data: suppliers = [] } = useSuppliers();

  const draftOrders = myOrders.filter(o => o.status === 'draft');
  const pendingOrders = myOrders.filter(o => ['submitted', 'under_review'].includes(o.status));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Camp Dashboard</h1>
        <p className="text-gray-500 mt-1">
          {user?.property_name || 'Your camp'} inventory and orders
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Inventory Items" value={inventory.length} icon={Package} color="bg-blue-500" href="/inventory" />
        <StatCard title="Low Stock Items" value={lowStock.length} icon={AlertTriangle} color="bg-yellow-500" href="/inventory" />
        <StatCard title="Draft Orders" value={draftOrders.length} icon={ClipboardList} color="bg-gray-500" href="/orders" />
        <StatCard title="Pending Orders" value={pendingOrders.length} icon={ClipboardList} color="bg-orange-500" href="/orders" />
      </div>

      {lowStock.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <div className="flex items-center mb-4">
            <AlertTriangle className="h-6 w-6 text-yellow-600 mr-2" />
            <h2 className="text-lg font-semibold text-yellow-800">
              Low Stock Alert ({lowStock.length} items)
            </h2>
          </div>
          <div className="space-y-2">
            {lowStock.slice(0, 5).map((item) => (
              <div key={item.id} className="flex justify-between items-center py-2 border-b border-yellow-200 last:border-0">
                <span className="font-medium text-gray-900">
                  {item.name}
                  {item.qty && <span className="text-gray-500 ml-1">- {item.qty}</span>}
                </span>
                <span className="text-yellow-700">
                  {item.current_stock}{item.order_at != null ? ` (order at ${item.order_at})` : ''} / {item.par_level} {item.unit}
                </span>
              </div>
            ))}
          </div>
          <Link href="/orders/new" className="inline-block mt-4 text-yellow-700 hover:text-yellow-800 font-medium">
            Create Order for Low Stock Items →
          </Link>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Recent Orders</h2>
        {myOrders.length === 0 ? (
          <p className="text-gray-500">No orders yet</p>
        ) : (
          <div className="space-y-3">
            {myOrders.slice(0, 5).map((order) => (
              <div key={order.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-gray-900">Week of {new Date(order.week_of).toLocaleDateString()}</p>
                  <p className="text-sm text-gray-500">{order.items?.length || 0} items</p>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  order.status === 'approved' ? 'bg-green-100 text-green-800' :
                  order.status === 'submitted' ? 'bg-blue-100 text-blue-800' :
                  order.status === 'changes_requested' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {order.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Purchasing Supervisor Dashboard
function SupervisorDashboard() {
  const { data: pendingReview = [] } = usePendingReviewOrders();
  const { data: allOrders = [] } = useOrders();
  const { data: suppliers = [] } = useSuppliers();
  const { data: properties = [] } = useProperties();

  const approvedOrders = allOrders.filter(o => o.status === 'approved');
  const orderedOrders = allOrders.filter(o => ['ordered', 'partially_received'].includes(o.status));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Supervisor Dashboard</h1>
        <p className="text-gray-500 mt-1">Order review and management across all properties</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Pending Review" value={pendingReview.length} icon={ClipboardList} color="bg-orange-500" href="/orders/review" />
        <StatCard title="Approved Orders" value={approvedOrders.length} icon={CheckCircle2} color="bg-green-500" href="/orders/all" />
        <StatCard title="In Transit" value={orderedOrders.length} icon={Truck} color="bg-blue-500" href="/orders/all" />
        <StatCard title="Properties" value={properties.length} icon={Building2} color="bg-purple-500" />
      </div>

      {pendingReview.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
          <div className="flex items-center mb-4">
            <ClipboardList className="h-6 w-6 text-orange-600 mr-2" />
            <h2 className="text-lg font-semibold text-orange-800">
              Orders Awaiting Review ({pendingReview.length})
            </h2>
          </div>
          <div className="space-y-2">
            {pendingReview.slice(0, 5).map((order) => (
              <div key={order.id} className="flex justify-between items-center py-2 border-b border-orange-200 last:border-0">
                <div>
                  <span className="font-medium text-gray-900">{order.property_name}</span>
                  <span className="text-gray-500 ml-2">- Week of {new Date(order.week_of).toLocaleDateString()}</span>
                </div>
                <span className="text-orange-700">{order.items?.length || 0} items</span>
              </div>
            ))}
          </div>
          <Link href="/orders/review" className="inline-block mt-4 text-orange-700 hover:text-orange-800 font-medium">
            Review Orders →
          </Link>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Orders</h2>
        {allOrders.length === 0 ? (
          <p className="text-gray-500">No orders yet</p>
        ) : (
          <div className="space-y-3">
            {allOrders.slice(0, 5).map((order) => (
              <div key={order.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-gray-900">{order.property_name}</p>
                  <p className="text-sm text-gray-500">Week of {new Date(order.week_of).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  {order.total_approved_value && (
                    <p className="font-medium text-gray-900">{formatCurrency(order.total_approved_value)}</p>
                  )}
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    order.status === 'approved' ? 'bg-green-100 text-green-800' :
                    order.status === 'submitted' || order.status === 'under_review' ? 'bg-blue-100 text-blue-800' :
                    order.status === 'ordered' ? 'bg-purple-100 text-purple-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {order.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Purchasing Team Dashboard
function PurchasingTeamDashboard() {
  const { data: receipts = [] } = useReceipts();
  const { data: financialData } = useFinancialDashboard();
  const { data: allOrders = [] } = useOrders();

  const unprocessedReceipts = receipts.filter(r => !r.is_processed);
  const unverifiedReceipts = receipts.filter(r => r.is_processed && !r.is_manually_verified);
  const orderedOrders = allOrders.filter(o => o.status === 'ordered');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Purchasing Team Dashboard</h1>
        <p className="text-gray-500 mt-1">Receipt management and financial tracking</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Receipts" value={receipts.length} icon={Receipt} color="bg-blue-500" href="/receipts" />
        <StatCard title="To Process" value={unprocessedReceipts.length} icon={Receipt} color="bg-yellow-500" href="/receipts" />
        <StatCard title="To Verify" value={unverifiedReceipts.length} icon={CheckCircle2} color="bg-orange-500" href="/receipts" />
        <StatCard title="Orders to Fulfill" value={orderedOrders.length} icon={ClipboardList} color="bg-purple-500" href="/orders/all" />
      </div>

      {financialData && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-gray-500">Total Spending</p>
              <p className="text-2xl font-bold text-primary-600">{formatCurrency(financialData.total_spending)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Average Receipt</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(financialData.avg_receipt_total)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Receipt Count</p>
              <p className="text-2xl font-bold text-gray-900">{financialData.receipt_count}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Receipts</h2>
        {receipts.length === 0 ? (
          <p className="text-gray-500">No receipts yet</p>
        ) : (
          <div className="space-y-3">
            {receipts.slice(0, 5).map((receipt) => (
              <div key={receipt.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-gray-900">{receipt.supplier_name || 'Unknown Supplier'}</p>
                  <p className="text-sm text-gray-500">
                    {receipt.receipt_date ? new Date(receipt.receipt_date).toLocaleDateString() : 'No date'}
                    {receipt.receipt_number && ` - #${receipt.receipt_number}`}
                  </p>
                </div>
                <div className="text-right">
                  {receipt.total && <p className="font-medium text-gray-900">{formatCurrency(receipt.total)}</p>}
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    receipt.is_manually_verified ? 'bg-green-100 text-green-800' :
                    receipt.is_processed ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {receipt.is_manually_verified ? 'Verified' : receipt.is_processed ? 'Processed' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuthStore();

  const renderDashboard = () => {
    switch (user?.role) {
      case 'admin':
        return <AdminDashboard />;
      case 'camp_worker':
        return <CampWorkerDashboard />;
      case 'purchasing_supervisor':
        return <SupervisorDashboard />;
      case 'purchasing_team':
        return <PurchasingTeamDashboard />;
      default:
        return (
          <div className="text-center py-12">
            <p className="text-gray-500">Loading dashboard...</p>
          </div>
        );
    }
  };

  return <DashboardLayout>{renderDashboard()}</DashboardLayout>;
}
