'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2, Plus, Send, Search, AlertTriangle, Package, ChevronDown, ChevronRight, Check } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useOrder, useUpdateDraftOrderItem, useDeleteOrderItem, useAddOrderItem, useSubmitOrder, useResubmitOrder } from '@/hooks/useOrders';
import { useInventoryItems } from '@/hooks/useInventory';
import toast from 'react-hot-toast';

export default function EditOrderPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = parseInt(params.id as string);
  const { user } = useAuthStore();

  const { data: order, isLoading: orderLoading, refetch } = useOrder(orderId);
  const { data: inventory = [] } = useInventoryItems(user?.property_id || undefined);
  const updateItem = useUpdateDraftOrderItem();
  const deleteItem = useDeleteOrderItem();
  const addItem = useAddOrderItem();
  const submitOrder = useSubmitOrder();
  const resubmitOrder = useResubmitOrder();

  const [showAddItem, setShowAddItem] = useState(false);
  const [showInventoryBrowser, setShowInventoryBrowser] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryBrowserSearch, setInventoryBrowserSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [customItemName, setCustomItemName] = useState('');
  const [customUnit, setCustomUnit] = useState('unit');

  // Check if order can be edited
  const canEdit = order && (order.status === 'draft' || order.status === 'changes_requested');

  // Filter inventory for add item search
  const existingItemIds = new Set(order?.items?.map(i => i.inventory_item_id).filter(Boolean) || []);
  const filteredInventory = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(inventorySearch.toLowerCase());
    const notAlreadyAdded = !existingItemIds.has(item.id);
    return matchesSearch && notAlreadyAdded;
  });

  // Group inventory by category for browsing
  const groupedInventory = inventory
    .filter(item => {
      if (!inventoryBrowserSearch) return true;
      return item.name.toLowerCase().includes(inventoryBrowserSearch.toLowerCase()) ||
             item.category?.toLowerCase().includes(inventoryBrowserSearch.toLowerCase());
    })
    .reduce((acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {} as Record<string, typeof inventory>);

  const sortedCategories = Object.keys(groupedInventory).sort();

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const expandAllCategories = () => {
    setExpandedCategories(new Set(sortedCategories));
  };

  const collapseAllCategories = () => {
    setExpandedCategories(new Set());
  };

  const handleQuantityChange = async (itemId: number, newQuantity: number) => {
    if (newQuantity < 1) return;
    try {
      await updateItem.mutateAsync({ orderId, itemId, quantity: newQuantity });
    } catch (error: any) {
      toast.error('Failed to update quantity');
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!confirm('Remove this item from the order?')) return;
    try {
      await deleteItem.mutateAsync({ orderId, itemId });
      toast.success('Item removed');
      refetch();
    } catch (error: any) {
      toast.error('Failed to remove item');
    }
  };

  const handleAddInventoryItem = async (inventoryItemId: number) => {
    const invItem = inventory.find(i => i.id === inventoryItemId);
    if (!invItem) return;

    try {
      await addItem.mutateAsync({
        orderId,
        item: {
          inventory_item_id: inventoryItemId,
          requested_quantity: Math.ceil(invItem.suggested_order_qty) || 1,
          unit: invItem.effective_order_unit || invItem.unit,
          flag: invItem.is_low_stock ? 'low_stock' : 'manual',
        }
      });
      toast.success('Item added');
      setInventorySearch('');
      setShowAddItem(false);
      refetch();
    } catch (error: any) {
      toast.error('Failed to add item');
    }
  };

  const handleAddCustomItem = async () => {
    if (!customItemName.trim()) {
      toast.error('Please enter item name');
      return;
    }

    try {
      await addItem.mutateAsync({
        orderId,
        item: {
          custom_item_name: customItemName,
          requested_quantity: 1,
          unit: customUnit,
          flag: 'custom',
        }
      });
      toast.success('Custom item added');
      setCustomItemName('');
      setCustomUnit('unit');
      setShowAddItem(false);
      refetch();
    } catch (error: any) {
      toast.error('Failed to add item');
    }
  };

  const handleSubmit = async () => {
    if (!order) return;
    if (order.items?.length === 0) {
      toast.error('Cannot submit empty order');
      return;
    }

    if (!confirm('Submit this order for review?')) return;

    try {
      if (order.status === 'changes_requested') {
        await resubmitOrder.mutateAsync({ id: orderId });
      } else {
        await submitOrder.mutateAsync(orderId);
      }
      toast.success('Order submitted for review');
      router.push('/orders');
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to submit order');
    }
  };

  if (orderLoading) {
    return (
      <RoleGuard allowedRoles={['camp_worker']}>
        <DashboardLayout>
          <div className="text-center py-12">Loading order...</div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  if (!order) {
    return (
      <RoleGuard allowedRoles={['camp_worker']}>
        <DashboardLayout>
          <div className="text-center py-12">
            <p className="text-gray-500">Order not found</p>
            <Link href="/orders" className="text-primary-600 hover:underline mt-2 block">
              Back to Orders
            </Link>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  if (!canEdit) {
    return (
      <RoleGuard allowedRoles={['camp_worker']}>
        <DashboardLayout>
          <div className="text-center py-12">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <p className="text-gray-700 font-medium">Cannot edit this order</p>
            <p className="text-gray-500 mt-1">Order status: {order.status.replace('_', ' ')}</p>
            <Link href="/orders" className="text-primary-600 hover:underline mt-4 block">
              Back to Orders
            </Link>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allowedRoles={['camp_worker']}>
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/orders" className="text-gray-500 hover:text-gray-700">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Edit Order</h1>
                <p className="text-gray-500 mt-1">
                  {order.order_number} - Week of {new Date(order.week_of).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              {order.status === 'changes_requested' && (
                <span className="px-3 py-1 text-sm font-medium bg-red-100 text-red-800 rounded-full">
                  Changes Requested
                </span>
              )}
            </div>
          </div>

          {/* Review Notes (if changes were requested) */}
          {order.review_notes && order.status === 'changes_requested' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">Reviewer Notes:</p>
                  <p className="text-amber-700 mt-1">{order.review_notes}</p>
                </div>
              </div>
            </div>
          )}

          {/* Order Items Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-semibold text-gray-900">Order Items ({order.items?.length || 0})</h2>
              <Button variant="outline" size="sm" onClick={() => setShowAddItem(!showAddItem)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Item
              </Button>
            </div>

            {/* Add Item Section */}
            {showAddItem && (
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <div className="space-y-4">
                  {/* Search Inventory */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Search Inventory</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={inventorySearch}
                        onChange={(e) => setInventorySearch(e.target.value)}
                        placeholder="Search items..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    {inventorySearch && filteredInventory.length > 0 && (
                      <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                        {filteredInventory.slice(0, 10).map(item => (
                          <button
                            key={item.id}
                            onClick={() => handleAddInventoryItem(item.id)}
                            className="w-full px-4 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                          >
                            <span className="font-medium">{item.name}</span>
                            <span className="text-sm text-gray-500 ml-2">({item.category || 'Uncategorized'})</span>
                            {item.is_low_stock && (
                              <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">Low Stock</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Custom Item */}
                  <div className="border-t border-gray-200 pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Or Add Custom Item</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customItemName}
                        onChange={(e) => setCustomItemName(e.target.value)}
                        placeholder="Custom item name"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="unit">Unit</option>
                        <option value="case">Case</option>
                        <option value="box">Box</option>
                        <option value="lb">Lb</option>
                        <option value="each">Each</option>
                      </select>
                      <Button onClick={handleAddCustomItem} disabled={!customItemName.trim()}>
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Items Table */}
            {order.items && order.items.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Par</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...order.items].sort((a, b) => a.id - b.id).map((item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900">{item.item_name || item.custom_item_name}</p>
                          {item.reviewer_notes && (
                            <p className="text-xs text-amber-600 mt-1">{item.reviewer_notes}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center text-sm text-gray-500">
                        {item.par_level ?? '-'}
                      </td>
                      <td className="px-6 py-4 text-center text-sm">
                        <span className={item.current_stock !== null && item.par_level !== null && item.current_stock < item.par_level ? 'text-yellow-600 font-medium' : 'text-gray-500'}>
                          {item.current_stock ?? '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.requested_quantity}
                          onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 1)}
                          className="w-20 mx-auto block text-center px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-6 py-4 text-center text-sm text-gray-500">
                        {item.unit}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No items in this order. Add some items above.
              </div>
            )}
          </div>

          {/* Inventory Browser */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setShowInventoryBrowser(!showInventoryBrowser)}
              className="w-full px-6 py-4 border-b border-gray-200 flex justify-between items-center hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-gray-500" />
                <div className="text-left">
                  <h2 className="font-semibold text-gray-900">Browse Full Inventory</h2>
                  <p className="text-sm text-gray-500">View all items to see stock levels and add to order</p>
                </div>
              </div>
              {showInventoryBrowser ? (
                <ChevronDown className="h-5 w-5 text-gray-400" />
              ) : (
                <ChevronRight className="h-5 w-5 text-gray-400" />
              )}
            </button>

            {showInventoryBrowser && (
              <div className="p-4 space-y-4">
                {/* Search and controls */}
                <div className="flex gap-3 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={inventoryBrowserSearch}
                      onChange={(e) => setInventoryBrowserSearch(e.target.value)}
                      placeholder="Search inventory..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <button
                    onClick={expandAllCategories}
                    className="text-sm text-primary-600 hover:text-primary-700 whitespace-nowrap"
                  >
                    Expand All
                  </button>
                  <button
                    onClick={collapseAllCategories}
                    className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap"
                  >
                    Collapse All
                  </button>
                </div>

                {/* Category accordion */}
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
                  {sortedCategories.map(category => {
                    const items = groupedInventory[category];
                    const isExpanded = expandedCategories.has(category);
                    const lowStockCount = items.filter(i => i.is_low_stock).length;

                    return (
                      <div key={category}>
                        <button
                          onClick={() => toggleCategory(category)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                            <span className="font-medium text-gray-900">{category}</span>
                            <span className="text-sm text-gray-500">({items.length})</span>
                            {lowStockCount > 0 && (
                              <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                                {lowStockCount} low
                              </span>
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="bg-gray-50 border-t border-gray-200">
                            <table className="min-w-full">
                              <thead>
                                <tr className="bg-gray-100">
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-20">Par</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-20">Stock</th>
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-20">Status</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {items.map(item => {
                                  const isInOrder = existingItemIds.has(item.id);
                                  const stockStatus = item.par_level !== null && item.current_stock < item.par_level;

                                  return (
                                    <tr key={item.id} className={isInOrder ? 'bg-green-50' : 'bg-white'}>
                                      <td className="px-4 py-2">
                                        <span className="text-sm text-gray-900">{item.name}</span>
                                      </td>
                                      <td className="px-4 py-2 text-center text-sm text-gray-500">
                                        {item.par_level ?? '-'}
                                      </td>
                                      <td className="px-4 py-2 text-center text-sm">
                                        <span className={stockStatus ? 'text-yellow-600 font-medium' : 'text-gray-500'}>
                                          {item.current_stock}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        {item.is_low_stock ? (
                                          <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">Low</span>
                                        ) : (
                                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">OK</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        {isInOrder ? (
                                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                                            <Check className="h-3 w-3" />
                                            In Order
                                          </span>
                                        ) : (
                                          <button
                                            onClick={() => handleAddInventoryItem(item.id)}
                                            className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
                                          >
                                            + Add
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {sortedCategories.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No items found matching your search
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center">
            <Link href="/orders">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button
              onClick={handleSubmit}
              disabled={!order.items || order.items.length === 0 || submitOrder.isPending || resubmitOrder.isPending}
              isLoading={submitOrder.isPending || resubmitOrder.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              {order.status === 'changes_requested' ? 'Resubmit Order' : 'Submit for Review'}
            </Button>
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
