'use client';

import { useState } from 'react';
import { Eye, Building2, Send, Package, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useOrders, useOrder, useMarkOrderOrdered, useReceiveOrderItems } from '@/hooks/useOrders';
import { useProperties } from '@/hooks/useProperties';
import { formatCurrency } from '@/lib/utils';
import type { Order, OrderStatus } from '@/types';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-blue-100 text-blue-800',
  under_review: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  changes_requested: 'bg-red-100 text-red-800',
  ordered: 'bg-purple-100 text-purple-800',
  partially_received: 'bg-indigo-100 text-indigo-800',
  received: 'bg-teal-100 text-teal-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function AllOrdersPage() {
  const { data: properties = [] } = useProperties();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  const { data: orders = [], isLoading } = useOrders({
    status: statusFilter || undefined,
    property_id: propertyFilter ? parseInt(propertyFilter) : undefined,
  });
  const markOrdered = useMarkOrderOrdered();
  const receiveItems = useReceiveOrderItems();

  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const { data: viewingOrder, refetch: refetchOrder } = useOrder(viewingOrderId || 0);
  const [receivingMode, setReceivingMode] = useState(false);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<number, number>>({});

  const handleMarkOrdered = async (orderId: number) => {
    try {
      await markOrdered.mutateAsync(orderId);
      toast.success('Order marked as ordered');
      refetchOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update order');
    }
  };

  const handleStartReceiving = () => {
    if (!viewingOrder) return;
    const quantities: Record<number, number> = {};
    viewingOrder.items?.forEach(item => {
      quantities[item.id] = item.approved_quantity || item.requested_quantity;
    });
    setReceiveQuantities(quantities);
    setReceivingMode(true);
  };

  const handleReceive = async () => {
    if (!viewingOrder) return;
    const items = Object.entries(receiveQuantities).map(([id, qty]) => ({
      item_id: parseInt(id),
      received_quantity: qty,
    }));
    try {
      await receiveItems.mutateAsync({ id: viewingOrder.id, items });
      toast.success('Items received successfully');
      setReceivingMode(false);
      refetchOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to receive items');
    }
  };

  const statuses: OrderStatus[] = ['draft', 'submitted', 'under_review', 'approved', 'changes_requested', 'ordered', 'partially_received', 'received', 'cancelled'];

  return (
    <RoleGuard allowedRoles={['purchasing_supervisor', 'purchasing_team']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">All Orders</h1>
              <p className="text-gray-500 mt-1">View and manage orders across all properties</p>
            </div>
            <Link href="/orders/flagged-items">
              <Button variant="outline">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Flagged Items
              </Button>
            </Link>
          </div>

          {/* Filters */}
          <div className="flex gap-4 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | '')}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Statuses</option>
              {statuses.map(status => (
                <option key={status} value={status}>{status.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Properties</option>
              {properties.map(prop => (
                <option key={prop.id} value={prop.id}>{prop.name}</option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">Loading...</div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center">
                <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No orders found</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Week Of</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created By</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Building2 className="h-4 w-4 text-gray-400 mr-2" />
                          <span className="font-medium text-gray-900">{order.property_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(order.week_of).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.items?.length || 0} items
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {order.total_approved_value ? formatCurrency(order.total_approved_value) : order.total_requested_value ? formatCurrency(order.total_requested_value) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[order.status]}`}>
                          {order.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.created_by_name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onClick={() => setViewingOrderId(order.id)} className="text-primary-600 hover:text-primary-900">
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* View Order Modal */}
        <Modal
          isOpen={!!viewingOrderId}
          onClose={() => { setViewingOrderId(null); setReceivingMode(false); }}
          title="Order Details"
          size="xl"
        >
          {viewingOrder && (
            <div className="space-y-6">
              <div className="grid grid-cols-4 gap-4 bg-gray-50 rounded-lg p-4">
                <div>
                  <p className="text-sm text-gray-500">Property</p>
                  <p className="font-medium">{viewingOrder.property_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Week Of</p>
                  <p className="font-medium">{new Date(viewingOrder.week_of).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[viewingOrder.status]}`}>
                    {viewingOrder.status.replace('_', ' ')}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Value</p>
                  <p className="font-medium">{viewingOrder.total_approved_value ? formatCurrency(viewingOrder.total_approved_value) : '-'}</p>
                </div>
              </div>

              {/* Items table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Approved</th>
                      {receivingMode && (
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Receive</th>
                      )}
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {viewingOrder.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2 text-sm font-medium">{item.item_name || item.custom_item_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{item.supplier_name || '-'}</td>
                        <td className="px-4 py-2 text-sm">{item.approved_quantity ?? item.requested_quantity} {item.unit}</td>
                        {receivingMode && (
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={receiveQuantities[item.id] || 0}
                              onChange={(e) => setReceiveQuantities({
                                ...receiveQuantities,
                                [item.id]: parseFloat(e.target.value) || 0,
                              })}
                              className="w-20 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                            />
                          </td>
                        )}
                        <td className="px-4 py-2 text-sm">{item.quantity_received ?? '-'} {item.quantity_received ? item.unit : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                {viewingOrder.status === 'approved' && (
                  <Button onClick={() => handleMarkOrdered(viewingOrder.id)} isLoading={markOrdered.isPending}>
                    <Send className="h-4 w-4 mr-1" />
                    Mark as Ordered
                  </Button>
                )}
                {(viewingOrder.status === 'ordered' || viewingOrder.status === 'partially_received') && !receivingMode && (
                  <Button onClick={handleStartReceiving}>
                    <Package className="h-4 w-4 mr-1" />
                    Receive Items
                  </Button>
                )}
                {receivingMode && (
                  <>
                    <Button variant="outline" onClick={() => setReceivingMode(false)}>Cancel</Button>
                    <Button onClick={handleReceive} isLoading={receiveItems.isPending}>
                      Confirm Receipt
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
