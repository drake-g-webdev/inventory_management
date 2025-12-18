'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Eye, Edit2, Send, Package } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useMyOrders, useSubmitOrder, useOrder } from '@/hooks/useOrders';
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

export default function MyOrdersPage() {
  const { data: orders = [], isLoading } = useMyOrders();
  const submitOrder = useSubmitOrder();
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const { data: viewingOrder } = useOrder(viewingOrderId || 0);

  const handleSubmit = async (orderId: number) => {
    if (!confirm('Submit this order for review?')) return;
    try {
      await submitOrder.mutateAsync(orderId);
      toast.success('Order submitted for review');
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : 'Failed to submit order';
      toast.error(message);
    }
  };

  return (
    <RoleGuard allowedRoles={['camp_worker']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
              <p className="text-gray-500 mt-1">Manage your weekly orders</p>
            </div>
            <Link href="/orders/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Order
              </Button>
            </Link>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">Loading...</div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center">
                <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No orders yet</p>
                <Link href="/orders/new">
                  <Button>Create Your First Order</Button>
                </Link>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Week Of</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-medium text-gray-900">
                          {new Date(order.week_of).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.item_count ?? order.items?.length ?? 0} items
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[order.status]}`}>
                          {order.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.submitted_at ? new Date(order.submitted_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onClick={() => setViewingOrderId(order.id)} className="text-primary-600 hover:text-primary-900 mr-3">
                          <Eye className="h-4 w-4" />
                        </button>
                        {order.status === 'draft' && (
                          <>
                            <Link href={`/orders/${order.id}/edit`} className="text-gray-600 hover:text-gray-900 mr-3">
                              <Edit2 className="h-4 w-4 inline" />
                            </Link>
                            <button onClick={() => handleSubmit(order.id)} className="text-green-600 hover:text-green-900">
                              <Send className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {order.status === 'changes_requested' && (
                          <Link href={`/orders/${order.id}/edit`} className="text-orange-600 hover:text-orange-900">
                            <Edit2 className="h-4 w-4 inline" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* View Order Modal */}
        <Modal isOpen={!!viewingOrderId} onClose={() => setViewingOrderId(null)} title="Order Details" size="lg">
          {viewingOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
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
              </div>

              {viewingOrder.review_notes && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-yellow-800">Review Notes:</p>
                  <p className="text-sm text-yellow-700">{viewingOrder.review_notes}</p>
                </div>
              )}

              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Approved</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {viewingOrder.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2 text-sm">{item.item_name || item.custom_item_name}</td>
                        <td className="px-4 py-2 text-sm">{item.requested_quantity} {item.unit}</td>
                        <td className="px-4 py-2 text-sm">{item.approved_quantity ?? '-'} {item.approved_quantity ? item.unit : ''}</td>
                        <td className="px-4 py-2 text-sm">{item.received_quantity ?? '-'} {item.received_quantity ? item.unit : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
