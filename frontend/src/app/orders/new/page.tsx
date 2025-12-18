'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';
import { useInventoryItems, useLowStockItems } from '@/hooks/useInventory';
import { useCreateOrder } from '@/hooks/useOrders';
import type { CreateOrderPayload, InventoryItem, OrderItemFlag } from '@/types';
import toast from 'react-hot-toast';

interface OrderLineItem {
  inventory_item_id: number | null;
  custom_item_name: string | null;
  quantity_requested: number;
  unit: string;  // This is now the ORDER unit (effective_order_unit)
  flag: OrderItemFlag | null;
  notes: string | null;
  // For display
  name: string;
  suggested_qty: number;
  par_level: number | null;
  current_stock: number | null;
  inventory_unit: string | null;  // The unit used for counting
}

export default function NewOrderPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { data: inventory = [] } = useInventoryItems(user?.property_id || undefined);
  const { data: lowStock = [] } = useLowStockItems(user?.property_id || undefined);
  const createOrder = useCreateOrder();

  const [weekOf, setWeekOf] = useState(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    return monday.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderLineItem[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [customItemName, setCustomItemName] = useState('');
  const [customUnit, setCustomUnit] = useState('unit');
  const [inventorySearch, setInventorySearch] = useState('');

  // Filter inventory based on search
  const filteredInventory = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(inventorySearch.toLowerCase());
    const notAlreadyAdded = !items.some(i => i.inventory_item_id === item.id);
    return matchesSearch && notAlreadyAdded;
  });

  // Auto-populate with low stock items (only recurring items - not one-offs)
  useEffect(() => {
    if (lowStock.length > 0 && items.length === 0) {
      // Filter out non-recurring (one-off) items - they should never be auto-added
      const recurringLowStock = lowStock.filter(item => item.is_recurring !== false);
      const lowStockItems: OrderLineItem[] = recurringLowStock.map(item => ({
        inventory_item_id: item.id,
        custom_item_name: null,
        quantity_requested: Math.ceil(item.suggested_order_qty),
        unit: item.effective_order_unit || item.unit,  // Use order unit for ordering
        flag: 'low_stock',
        notes: null,
        name: item.name,
        suggested_qty: Math.ceil(item.suggested_order_qty),
        par_level: item.par_level,
        current_stock: item.current_stock,
        inventory_unit: item.unit,  // Keep track of counting unit
      }));
      setItems(lowStockItems);
    }
  }, [lowStock]);

  const addItem = () => {
    if (selectedItemId === 'custom') {
      if (!customItemName.trim()) {
        toast.error('Please enter an item name');
        return;
      }
      setItems([...items, {
        inventory_item_id: null,
        custom_item_name: customItemName,
        quantity_requested: 1,
        unit: customUnit,
        flag: 'custom',
        notes: null,
        name: customItemName,
        suggested_qty: 0,
        par_level: null,
        current_stock: null,
        inventory_unit: null,
      }]);
      setCustomItemName('');
      setCustomUnit('unit');
    } else {
      const invItem = inventory.find(i => i.id === parseInt(selectedItemId));
      if (!invItem) return;

      // Check if already added
      if (items.some(i => i.inventory_item_id === invItem.id)) {
        toast.error('Item already in order');
        return;
      }

      setItems([...items, {
        inventory_item_id: invItem.id,
        custom_item_name: null,
        quantity_requested: Math.ceil(invItem.suggested_order_qty) || 1,
        unit: invItem.effective_order_unit || invItem.unit,  // Use order unit
        flag: 'manual',
        notes: null,
        name: invItem.name,
        suggested_qty: Math.ceil(invItem.suggested_order_qty),
        par_level: invItem.par_level,
        current_stock: invItem.current_stock,
        inventory_unit: invItem.unit,  // Keep track of counting unit
      }]);
    }
    setSelectedItemId('');
    setShowAddItem(false);
  };

  const updateItemQuantity = (index: number, quantity: number) => {
    const updated = [...items];
    updated[index].quantity_requested = Math.max(0, Math.floor(quantity));
    setItems(updated);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    const payload: CreateOrderPayload = {
      property_id: user?.property_id || 0,
      week_of: weekOf ? `${weekOf}T00:00:00` : undefined,
      notes: notes || undefined,
      items: items.map(item => ({
        inventory_item_id: item.inventory_item_id,
        custom_item_name: item.custom_item_name,
        requested_quantity: item.quantity_requested,
        unit: item.unit,
        flag: item.flag,
        camp_notes: item.notes,
      })),
    };

    try {
      const order = await createOrder.mutateAsync(payload);
      toast.success(asDraft ? 'Order saved as draft' : 'Order created');
      router.push('/orders');
    } catch (error: any) {
      let errorMessage = 'Failed to create order';
      const detail = error.response?.data?.detail;
      if (detail) {
        if (typeof detail === 'string') {
          errorMessage = detail;
        } else if (Array.isArray(detail)) {
          // Pydantic validation errors come as array of objects with 'msg' field
          errorMessage = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ');
        } else if (typeof detail === 'object') {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        }
      }
      toast.error(errorMessage);
    }
  };

  return (
    <RoleGuard allowedRoles={['camp_worker']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create New Order</h1>
            <p className="text-gray-500 mt-1">Build your weekly order from inventory items</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="grid grid-cols-2 gap-6 mb-6">
              <Input
                id="week_of"
                label="Week Of"
                type="date"
                value={weekOf}
                onChange={(e) => setWeekOf(e.target.value)}
              />
              <Input
                id="notes"
                label="Notes (Optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special instructions..."
              />
            </div>

            {/* Low stock notice */}
            {lowStock.length > 0 && items.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-start">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 mt-0.5" />
                <div>
                  <p className="text-yellow-800 font-medium">Low stock items auto-added</p>
                  <p className="text-sm text-yellow-700">Items below par level have been added with suggested quantities. Review and adjust as needed.</p>
                </div>
              </div>
            )}

            {/* Items list */}
            <div className="border rounded-lg overflow-hidden mb-6">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Flag</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Par</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Current</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Order Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase w-16">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        No items added yet. Click "Add Item" to get started.
                      </td>
                    </tr>
                  ) : (
                    items.map((item, index) => (
                      <tr key={index} className={item.flag === 'low_stock' ? 'bg-yellow-50' : ''}>
                        <td className="px-4 py-3">
                          <div className="flex items-center">
                            {item.flag === 'low_stock' && <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />}
                            <span className="font-medium">{item.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            item.flag === 'low_stock' ? 'bg-yellow-100 text-yellow-800' :
                            item.flag === 'custom' ? 'bg-purple-100 text-purple-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {item.flag?.replace('_', ' ') || 'manual'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-gray-600">
                          {item.par_level ?? '-'}
                          {item.par_level !== null && item.inventory_unit && (
                            <span className="text-xs text-gray-400 ml-1">{item.inventory_unit}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-gray-600">
                          <span className={item.current_stock !== null && item.par_level !== null && item.current_stock < item.par_level ? 'text-yellow-600 font-medium' : ''}>
                            {item.current_stock ?? '-'}
                          </span>
                          {item.current_stock !== null && item.inventory_unit && (
                            <span className="text-xs text-gray-400 ml-1">{item.inventory_unit}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.quantity_requested}
                            onChange={(e) => updateItemQuantity(index, parseInt(e.target.value) || 0)}
                            className="w-20 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                          />
                          {item.suggested_qty > 0 && item.quantity_requested !== item.suggested_qty && (
                            <span className="text-xs text-gray-500 ml-2">(suggested: {item.suggested_qty})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{item.unit}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => removeItem(index)} className="text-red-600 hover:text-red-900">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Add item section */}
            {showAddItem ? (
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-medium">Add Item</h3>
                  <Button variant="outline" size="sm" onClick={() => { setShowAddItem(false); setInventorySearch(''); setSelectedItemId(''); }}>
                    Close
                  </Button>
                </div>

                {/* Search bar */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search inventory items..."
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    autoFocus
                  />
                </div>

                {/* Search results */}
                {inventorySearch && (
                  <div className="mb-4 max-h-60 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                    {filteredInventory.length === 0 ? (
                      <div className="p-4 text-center text-gray-500 text-sm">
                        No items found matching "{inventorySearch}"
                      </div>
                    ) : (
                      filteredInventory.map(item => (
                        <button
                          key={item.id}
                          onClick={() => {
                            setSelectedItemId(item.id.toString());
                            setInventorySearch('');
                            // Directly add the item
                            if (!items.some(i => i.inventory_item_id === item.id)) {
                              setItems([...items, {
                                inventory_item_id: item.id,
                                custom_item_name: null,
                                quantity_requested: Math.ceil(item.suggested_order_qty) || 1,
                                unit: item.effective_order_unit || item.unit,  // Use order unit
                                flag: item.is_low_stock ? 'low_stock' : 'manual',
                                notes: null,
                                name: item.name,
                                suggested_qty: Math.ceil(item.suggested_order_qty),
                                par_level: item.par_level,
                                current_stock: item.current_stock,
                                inventory_unit: item.unit,  // Keep track of counting unit
                              }]);
                            }
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 flex justify-between items-center"
                        >
                          <div>
                            <span className="font-medium text-gray-900">{item.name}</span>
                            <span className="text-sm text-gray-500 ml-2">({item.category || 'Uncategorized'})</span>
                          </div>
                          <div className="text-right text-sm">
                            <span className={item.is_low_stock ? 'text-yellow-600 font-medium' : 'text-gray-500'}>
                              {item.current_stock} {item.unit} in stock
                            </span>
                            {item.is_low_stock && (
                              <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">Low</span>
                            )}
                            {!item.is_recurring && (
                              <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">One-off</span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {/* Or select from dropdown */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Or select from dropdown</label>
                    <select
                      value={selectedItemId}
                      onChange={(e) => setSelectedItemId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">Choose from inventory...</option>
                      <option value="custom">-- Create Custom Item --</option>
                      {filteredInventory.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.current_stock} {item.unit} in stock){item.is_low_stock ? ' [LOW]' : ''}{!item.is_recurring ? ' [One-off]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button onClick={addItem} disabled={!selectedItemId}>Add</Button>
                  </div>
                </div>
                {selectedItemId === 'custom' && (
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <Input
                      id="custom_name"
                      label="Custom Item Name"
                      value={customItemName}
                      onChange={(e) => setCustomItemName(e.target.value)}
                      placeholder="Enter item name"
                    />
                    <Input
                      id="custom_unit"
                      label="Unit"
                      value={customUnit}
                      onChange={(e) => setCustomUnit(e.target.value)}
                      placeholder="lb, gallon, case, etc."
                    />
                  </div>
                )}
              </div>
            ) : (
              <Button variant="outline" onClick={() => setShowAddItem(true)} className="mb-6">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 border-t pt-6">
              <Button variant="outline" onClick={() => router.push('/orders')}>Cancel</Button>
              <Button variant="outline" onClick={() => handleSubmit(true)} isLoading={createOrder.isPending}>
                Save as Draft
              </Button>
              <Button onClick={() => handleSubmit(false)} isLoading={createOrder.isPending}>
                Create Order
              </Button>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
