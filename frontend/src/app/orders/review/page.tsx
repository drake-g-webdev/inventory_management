'use client';

import React, { useState, useMemo } from 'react';
import { CheckCircle2, Eye, Building2, ChevronDown, ChevronRight, Truck, ClipboardList, X } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import { usePendingReviewOrders, useReviewOrder, useOrder, useUpdateOrderItem } from '@/hooks/useOrders';
import { useSuppliers } from '@/hooks/useSuppliers';
import type { OrderItem } from '@/types';
import toast from 'react-hot-toast';

interface CategoryGroup {
  categoryName: string;
  items: OrderItem[];
}

interface SupplierGroup {
  supplierName: string;
  supplierId: number | null;
  categories: CategoryGroup[];
  totalItems: number;
}

export default function ReviewOrdersPage() {
  const { data: pendingOrders = [], isLoading } = usePendingReviewOrders();
  const { data: suppliers = [] } = useSuppliers();
  const reviewOrder = useReviewOrder();
  const updateOrderItem = useUpdateOrderItem();
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const { data: expandedOrder, refetch: refetchOrder } = useOrder(expandedOrderId || 0);
  const [reviewNotes, setReviewNotes] = useState('');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [editedQuantities, setEditedQuantities] = useState<Record<number, number>>({});
  const [editedSuppliers, setEditedSuppliers] = useState<Record<number, number | null>>({});
  const [savingItems, setSavingItems] = useState<Set<number>>(new Set());

  // Group items by supplier, then by category within each supplier
  const supplierGroups = useMemo((): SupplierGroup[] => {
    if (!expandedOrder?.items) return [];

    const groups: Record<string, { supplierId: number | null; items: OrderItem[] }> = {};

    for (const item of expandedOrder.items) {
      const supplierName = item.supplier_name || 'No Supplier';
      const supplierId = item.supplier_id ?? null;
      if (!groups[supplierName]) {
        groups[supplierName] = { supplierId, items: [] };
      }
      groups[supplierName].items.push(item);
    }

    // Sort suppliers alphabetically, but put "No Supplier" at the end
    return Object.entries(groups)
      .sort(([a], [b]) => {
        if (a === 'No Supplier') return 1;
        if (b === 'No Supplier') return -1;
        return a.localeCompare(b);
      })
      .map(([supplierName, data]) => {
        // Group items by category within each supplier
        const categoryMap: Record<string, OrderItem[]> = {};
        for (const item of data.items) {
          const categoryName = item.category || 'Other';
          if (!categoryMap[categoryName]) {
            categoryMap[categoryName] = [];
          }
          categoryMap[categoryName].push(item);
        }

        // Sort categories alphabetically, but put "Other" at the end
        const categories = Object.entries(categoryMap)
          .sort(([a], [b]) => {
            if (a === 'Other') return 1;
            if (b === 'Other') return -1;
            return a.localeCompare(b);
          })
          .map(([categoryName, items]) => ({
            categoryName,
            items: items.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''))
          }));

        return {
          supplierName,
          supplierId: data.supplierId,
          categories,
          totalItems: data.items.length
        };
      });
  }, [expandedOrder?.items]);

  const toggleSupplier = (supplierName: string) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(supplierName)) {
        next.delete(supplierName);
      } else {
        next.add(supplierName);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSuppliers(new Set(supplierGroups.map(g => g.supplierName)));
  };

  const collapseAll = () => {
    setExpandedSuppliers(new Set());
  };

  const handleReview = async (orderId: number, action: 'approve' | 'request_changes') => {
    try {
      await reviewOrder.mutateAsync({ id: orderId, action, review_notes: reviewNotes || undefined });
      toast.success(action === 'approve' ? 'Order list generated' : 'Changes requested');
      setExpandedOrderId(null);
      setReviewNotes('');
      setEditedQuantities({});
      setEditedSuppliers({});
      setExpandedSuppliers(new Set());
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Review failed');
    }
  };

  const handleSupplierChange = async (item: OrderItem, supplierId: string) => {
    const newSupplierId = supplierId ? parseInt(supplierId) : null;
    if (!expandedOrderId) return;

    setEditedSuppliers(prev => ({ ...prev, [item.id]: newSupplierId }));
    setSavingItems(prev => new Set(prev).add(item.id));

    try {
      await updateOrderItem.mutateAsync({
        orderId: expandedOrderId,
        itemId: item.id,
        data: { supplier_id: newSupplierId ?? undefined },
      });
      refetchOrder();
      toast.success('Supplier updated');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update supplier');
      setEditedSuppliers(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setSavingItems(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const getApprovedQty = (item: OrderItem): number => {
    if (editedQuantities[item.id] !== undefined) {
      return editedQuantities[item.id];
    }
    return item.approved_quantity ?? item.requested_quantity;
  };

  const handleQtyChange = (itemId: number, value: string) => {
    const qty = parseInt(value) || 0;
    setEditedQuantities(prev => ({ ...prev, [itemId]: qty }));
  };

  const handleQtyBlur = async (item: OrderItem) => {
    const newQty = editedQuantities[item.id];
    if (newQty === undefined) return;

    const currentApproved = item.approved_quantity ?? item.requested_quantity;
    if (newQty === currentApproved) return;

    if (!expandedOrderId) return;

    setSavingItems(prev => new Set(prev).add(item.id));
    try {
      await updateOrderItem.mutateAsync({
        orderId: expandedOrderId,
        itemId: item.id,
        data: { approved_quantity: newQty },
      });
      refetchOrder();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update quantity');
      setEditedQuantities(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } finally {
      setSavingItems(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const toggleOrderExpansion = (orderId: number) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      setReviewNotes('');
      setEditedQuantities({});
      setEditedSuppliers({});
      setExpandedSuppliers(new Set());
    } else {
      setExpandedOrderId(orderId);
      setEditedQuantities({});
      setEditedSuppliers({});
      setExpandedSuppliers(new Set());
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
              <div className="divide-y divide-gray-200">
                {pendingOrders.map((order) => (
                  <div key={order.id}>
                    <div className="flex items-center justify-between px-6 py-4 hover:bg-gray-50">
                      <div className="flex items-center gap-8">
                        <div className="flex items-center min-w-[200px]">
                          <Building2 className="h-4 w-4 text-gray-400 mr-2" />
                          <span className="font-medium text-gray-900">{order.property_name}</span>
                        </div>
                        <div className="text-sm text-gray-500 min-w-[120px]">
                          {new Date(order.week_of).toLocaleDateString()}
                        </div>
                        <div className="text-sm text-gray-500 min-w-[80px]">
                          {order.items?.length || 0} items
                        </div>
                        <div className="text-sm text-gray-500">
                          {order.created_by_name || 'Unknown'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => toggleOrderExpansion(order.id)}
                        variant={expandedOrderId === order.id ? 'outline' : 'primary'}
                      >
                        {expandedOrderId === order.id ? (
                          <React.Fragment>
                            <X className="h-4 w-4 mr-1" />
                            Close
                          </React.Fragment>
                        ) : (
                          <React.Fragment>
                            <Eye className="h-4 w-4 mr-1" />
                            Review
                          </React.Fragment>
                        )}
                      </Button>
                    </div>

                    {expandedOrderId === order.id && expandedOrder && (
                      <div className="bg-gray-50 border-t border-gray-200 px-6 py-6">
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-6">
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Order Number</p>
                                <p className="font-medium text-gray-900">{expandedOrder.order_number}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Property</p>
                                <p className="font-medium text-gray-900">{expandedOrder.property_name}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Week Of</p>
                                <p className="font-medium text-gray-900">{new Date(expandedOrder.week_of).toLocaleDateString()}</p>
                              </div>
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wider">Submitted By</p>
                                <p className="font-medium text-gray-900">{expandedOrder.created_by_name || 'Unknown'}</p>
                              </div>
                            </div>
                          </div>

                          {expandedOrder.notes && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                              <p className="text-sm font-medium text-blue-800">Order Notes:</p>
                              <p className="text-sm text-blue-700">{expandedOrder.notes}</p>
                            </div>
                          )}

                          <div className="flex justify-end gap-2">
                            <button
                              onClick={expandAll}
                              className="text-sm text-primary-600 hover:text-primary-800"
                            >
                              Expand All
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={collapseAll}
                              className="text-sm text-primary-600 hover:text-primary-800"
                            >
                              Collapse All
                            </button>
                          </div>

                          <div className="space-y-3">
                            {supplierGroups.map((group) => (
                              <div key={group.supplierName} className="border rounded-lg overflow-hidden bg-white">
                                <button
                                  onClick={() => toggleSupplier(group.supplierName)}
                                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 hover:bg-gray-200 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <Truck className="h-4 w-4 text-gray-500" />
                                    <span className="font-medium text-gray-900">{group.supplierName}</span>
                                    <span className="text-sm text-gray-500">({group.totalItems} items)</span>
                                  </div>
                                  {expandedSuppliers.has(group.supplierName) ? (
                                    <ChevronDown className="h-5 w-5 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="h-5 w-5 text-gray-400" />
                                  )}
                                </button>

                                {expandedSuppliers.has(group.supplierName) && (
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase" style={{ width: '180px' }}>Supplier</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{ width: '80px' }}>Par</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{ width: '80px' }}>Current</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{ width: '100px' }}>Requested</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase" style={{ width: '120px' }}>Approved</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200">
                                        {group.categories.map((category) => (
                                          <React.Fragment key={category.categoryName}>
                                            <tr className="bg-gray-700">
                                              <td colSpan={6} className="px-4 py-2 text-sm font-semibold text-white">
                                                {category.categoryName}
                                              </td>
                                            </tr>
                                            {category.items.map((item) => {
                                              const approvedQty = getApprovedQty(item);
                                              const isModified = approvedQty !== item.requested_quantity;
                                              const isSaving = savingItems.has(item.id);
                                              const isLowStock = item.current_stock != null &&
                                                item.par_level != null &&
                                                item.current_stock < item.par_level;
                                              const currentSupplierId = editedSuppliers[item.id] !== undefined
                                                ? editedSuppliers[item.id]
                                                : item.supplier_id;

                                              return (
                                                <tr key={item.id} className={isModified ? 'bg-yellow-50' : ''}>
                                                  <td className="px-4 py-2">
                                                    <span className="font-medium text-sm">{item.item_name || item.custom_item_name}</span>
                                                    {item.reviewer_notes && (
                                                      <p className="text-xs text-orange-600 mt-1">{item.reviewer_notes}</p>
                                                    )}
                                                  </td>
                                                  <td className="px-4 py-2">
                                                    <select
                                                      value={currentSupplierId ?? ''}
                                                      onChange={(e) => handleSupplierChange(item, e.target.value)}
                                                      disabled={isSaving}
                                                      className={`w-full px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500 border-gray-300 ${isSaving ? 'opacity-50' : ''}`}
                                                    >
                                                      <option value="">No Supplier</option>
                                                      {suppliers.map((supplier) => (
                                                        <option key={supplier.id} value={supplier.id}>
                                                          {supplier.name}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </td>
                                                  <td className="px-4 py-2 text-center text-sm text-gray-600">
                                                    {item.par_level ?? '-'}
                                                  </td>
                                                  <td className={`px-4 py-2 text-center text-sm ${isLowStock ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                                                    {item.current_stock ?? '-'}
                                                  </td>
                                                  <td className="px-4 py-2 text-center text-sm text-gray-900">
                                                    {item.requested_quantity} {item.unit}
                                                  </td>
                                                  <td className="px-4 py-2 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={approvedQty}
                                                        onChange={(e) => handleQtyChange(item.id, e.target.value)}
                                                        onBlur={() => handleQtyBlur(item)}
                                                        disabled={isSaving}
                                                        className={`w-16 px-2 py-1 text-center text-sm border rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                                                          isModified ? 'border-orange-300 bg-orange-50' : 'border-gray-300'
                                                        } ${isSaving ? 'opacity-50' : ''}`}
                                                      />
                                                      <span className="text-xs text-gray-500">{item.unit}</span>
                                                    </div>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </React.Fragment>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                              value={reviewNotes}
                              onChange={(e) => setReviewNotes(e.target.value)}
                              rows={3}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                              placeholder="Add any notes about this order..."
                            />
                          </div>

                          <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => toggleOrderExpansion(order.id)}>Cancel</Button>
                            <Button
                              onClick={() => handleReview(expandedOrder.id, 'approve')}
                              isLoading={reviewOrder.isPending}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <ClipboardList className="h-4 w-4 mr-1" />
                              Generate Order List
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
