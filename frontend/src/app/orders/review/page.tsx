'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Eye, Edit2, Building2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { usePendingReviewOrders, useReviewOrder, useOrder, useUpdateOrderItem } from '@/hooks/useOrders';
import { formatCurrency } from '@/lib/utils';
import type { Order, OrderItem } from '@/types';
import toast from 'react-hot-toast';

export default function ReviewOrdersPage() {
  const { data: pendingOrders = [], isLoading } = usePendingReviewOrders();
  const reviewOrder = useReviewOrder();
  const updateOrderItem = useUpdateOrderItem();
  const [reviewingOrderId, setReviewingOrderId] = useState<number | null>(null);
  const { data: reviewingOrder, refetch: refetchOrder } = useOrder(reviewingOrderId || 0);
  const [reviewNotes, setReviewNotes] = useState('');
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
  const [editQty, setEditQty] = useState<number>(0);
  const [editNotes, setEditNotes] = useState('');

  const handleReview = async (orderId: number, action: 'approve' | 'request_changes') => {
    if (action === 'request_changes' && !reviewNotes.trim()) {
      toast.error('Please provide notes for changes requested');
      return;
    }
    try {
      await reviewOrder.mutateAsync({ id: orderId, action, review_notes: reviewNotes || undefined });
      toast.success(action === 'approve' ? 'Order approved' : 'Changes requested');
      setReviewingOrderId(null);
      setReviewNotes('');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Review failed');
    }
  };

  const handleEditItem = (item: OrderItem) => {
    setEditingItem(item);
    setEditQty(item.approved_quantity ?? item.requested_quantity);
    setEditNotes(item.reviewer_notes || '');
  };

  const handleSaveItemEdit = async () => {
    if (!editingItem || !reviewingOrderId) return;
    try {
      await updateOrderItem.mutateAsync({
        orderId: reviewingOrderId,
        itemId: editingItem.id,
        data: {
          quantity_approved: editQty,
          review_notes: editNotes || undefined,
        },
      });
      toast.success('Item updated');
      setEditingItem(null);
      refetchOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Update failed');
    }
  };

  return (
    <RoleGuard allowedRoles={['purchasing_supervisor']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Review Orders</h1>
            <p className="text-gray-500 mt-1">Review and approve camp orders</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">Loading...</div>
            ) : pendingOrders.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-300 mx-auto mb-4" />
                <p className="text-gray-500">No orders pending review</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Week Of</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Est. Value</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted By</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pendingOrders.map((order) => (
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
                        {order.total_requested_value ? formatCurrency(order.total_requested_value) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {order.created_by_name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <Button size="sm" onClick={() => setReviewingOrderId(order.id)}>
                          <Eye className="h-4 w-4 mr-1" />
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Review Order Modal */}
        <Modal isOpen={!!reviewingOrderId} onClose={() => setReviewingOrderId(null)} title="Review Order" size="xl">
          {reviewingOrder && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded-lg p-4">
                <div>
                  <p className="text-sm text-gray-500">Property</p>
                  <p className="font-medium">{reviewingOrder.property_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Week Of</p>
                  <p className="font-medium">{new Date(reviewingOrder.week_of).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Submitted By</p>
                  <p className="font-medium">{reviewingOrder.created_by_name || 'Unknown'}</p>
                </div>
              </div>

              {reviewingOrder.notes && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-800">Order Notes:</p>
                  <p className="text-sm text-blue-700">{reviewingOrder.notes}</p>
                </div>
              )}

              {/* Items table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Approved</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Est. Cost</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Edit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {reviewingOrder.items?.map((item) => (
                      <tr key={item.id} className={item.approved_quantity !== null && item.approved_quantity !== item.requested_quantity ? 'bg-yellow-50' : ''}>
                        <td className="px-4 py-2">
                          <div>
                            <span className="font-medium">{item.item_name || item.custom_item_name}</span>
                            {item.reviewer_notes && (
                              <p className="text-xs text-orange-600 mt-1">{item.reviewer_notes}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-sm">{item.requested_quantity} {item.unit}</td>
                        <td className="px-4 py-2 text-sm">
                          <span className={item.approved_quantity !== null && item.approved_quantity !== item.requested_quantity ? 'text-orange-600 font-medium' : ''}>
                            {item.approved_quantity ?? item.requested_quantity} {item.unit}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {item.unit_price ? formatCurrency((item.approved_quantity ?? item.requested_quantity) * item.unit_price) : '-'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => handleEditItem(item)} className="text-primary-600 hover:text-primary-900">
                            <Edit2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Review notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Review Notes</label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Add notes about your review (required for requesting changes)..."
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setReviewingOrderId(null)}>Cancel</Button>
                <Button
                  variant="outline"
                  onClick={() => handleReview(reviewingOrder.id, 'request_changes')}
                  isLoading={reviewOrder.isPending}
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Request Changes
                </Button>
                <Button
                  onClick={() => handleReview(reviewingOrder.id, 'approve')}
                  isLoading={reviewOrder.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve Order
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Edit Item Modal */}
        <Modal isOpen={!!editingItem} onClose={() => setEditingItem(null)} title="Edit Item Quantity">
          {editingItem && (
            <div className="space-y-4">
              <p className="text-gray-600">
                Editing: <strong>{editingItem.item_name || editingItem.custom_item_name}</strong>
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Requested</p>
                  <p className="font-medium">{editingItem.requested_quantity} {editingItem.unit}</p>
                </div>
                <Input
                  id="approved_qty"
                  label="Approved Quantity"
                  type="number"
                  min="0"
                  step="0.5"
                  value={editQty.toString()}
                  onChange={(e) => setEditQty(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (Optional)</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Reason for change..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
                <Button onClick={handleSaveItemEdit} isLoading={updateOrderItem.isPending}>Save</Button>
              </div>
            </div>
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
