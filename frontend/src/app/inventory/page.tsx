'use client';

import { useState } from 'react';
import { Plus, Search, Edit2, Trash2, AlertTriangle, Printer, ChevronDown, ChevronRight, Package } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/authStore';
import { useInventoryItems, useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem } from '@/hooks/useInventory';
import { useSuppliers } from '@/hooks/useSuppliers';
import type { InventoryItem, CreateInventoryItemPayload } from '@/types';
import toast from 'react-hot-toast';

const CATEGORIES = ['Dairy', 'Protein', 'Produce', 'Dry Goods', 'Canned/Jarred', 'Beverages', 'Condiments', 'Other'];

function groupByCategory(items: InventoryItem[]) {
  return items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);
}

export default function InventoryPage() {
  const { user } = useAuthStore();
  const { data: items = [], isLoading } = useInventoryItems(user?.property_id || undefined);
  const { data: suppliers = [] } = useSuppliers();
  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();

  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState<CreateInventoryItemPayload>({
    property_id: user?.property_id || 0,
    name: '',
    unit: 'unit',
    category: '',
    supplier_id: null,
    par_level: null,
    current_stock: 0,
    unit_price: null,
    is_recurring: true,
  });

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const groupedItems = groupByCategory(filteredItems);
  const lowStockCount = filteredItems.filter(item => item.is_low_stock).length;

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const expandAll = () => setExpandedCategories(new Set(Object.keys(groupedItems)));
  const collapseAll = () => setExpandedCategories(new Set());

  const handleOpenModal = (item?: InventoryItem) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        property_id: item.property_id,
        name: item.name,
        description: item.description,
        category: item.category || '',
        supplier_id: item.supplier_id,
        unit: item.unit,
        par_level: item.par_level,
        current_stock: item.current_stock,
        unit_price: item.unit_price,
        is_recurring: item.is_recurring ?? true,
      });
    } else {
      setEditingItem(null);
      setFormData({
        property_id: user?.property_id || 0,
        name: '',
        unit: 'unit',
        category: '',
        supplier_id: null,
        par_level: null,
        current_stock: 0,
        unit_price: null,
        is_recurring: true,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await updateItem.mutateAsync({ id: editingItem.id, data: formData });
        toast.success('Item updated successfully');
      } else {
        await createItem.mutateAsync(formData);
        toast.success('Item created successfully');
      }
      setShowModal(false);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      await deleteItem.mutateAsync(id);
      toast.success('Item deleted successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Delete failed');
    }
  };

  const handleExportForm = () => {
    // Only include recurring items on the printout
    const recurringItems = filteredItems.filter(item => item.is_recurring !== false);
    const grouped = groupByCategory(recurringItems);
    const today = new Date().toLocaleDateString();

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to export the form');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Inventory Count Form - ${user?.property_name || 'Property'}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            font-size: 12px;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #333;
            padding-bottom: 15px;
          }
          .header h1 { margin: 0 0 5px 0; font-size: 24px; }
          .header p { margin: 5px 0; color: #666; }
          .info-row {
            display: flex;
            gap: 30px;
            margin-bottom: 20px;
            padding: 10px;
            background: #f5f5f5;
          }
          .info-row .field {
            flex: 1;
          }
          .info-row label {
            font-weight: bold;
            display: block;
            margin-bottom: 5px;
          }
          .info-row .line {
            border-bottom: 1px solid #333;
            height: 25px;
          }
          .category-section {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }
          .category-header {
            background: #333;
            color: white;
            padding: 8px 12px;
            font-weight: bold;
            font-size: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid #ccc;
            padding: 8px;
            text-align: left;
          }
          th {
            background: #f0f0f0;
            font-weight: bold;
          }
          .count-cell {
            width: 100px;
            background: #fffef0;
          }
          .unit-cell { width: 80px; }
          .par-cell { width: 80px; text-align: center; }
          .notes-cell { width: 150px; }
          .footer {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #ccc;
            font-size: 11px;
            color: #666;
          }
          @media print {
            body { padding: 10px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Inventory Count Form</h1>
          <p><strong>${user?.property_name || 'Property'}</strong></p>
          <p>Generated: ${today}</p>
        </div>

        <div class="info-row">
          <div class="field">
            <label>Count Date:</label>
            <div class="line"></div>
          </div>
          <div class="field">
            <label>Counted By:</label>
            <div class="line"></div>
          </div>
        </div>

        ${Object.entries(grouped).map(([category, categoryItems]) => `
          <div class="category-section">
            <div class="category-header">${category} (${categoryItems.length} items)</div>
            <table>
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th class="unit-cell">Unit</th>
                  <th class="par-cell">Par Level</th>
                  <th class="count-cell">Count</th>
                  <th class="notes-cell">Notes</th>
                </tr>
              </thead>
              <tbody>
                ${categoryItems.map(item => `
                  <tr>
                    <td>${item.name}</td>
                    <td class="unit-cell">${item.unit}</td>
                    <td class="par-cell">${item.par_level || '-'}</td>
                    <td class="count-cell"></td>
                    <td class="notes-cell"></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}

        <div class="footer">
          <p><strong>Instructions:</strong> Count each item and record the quantity in the "Count" column. Add any notes for discrepancies or observations.</p>
          <p>Total Items: ${recurringItems.length} | Categories: ${Object.keys(grouped).length}</p>
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <RoleGuard allowedRoles={['camp_worker', 'admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
              <p className="text-gray-500 mt-1">{user?.property_name || 'Your camp'} inventory items</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleExportForm} disabled={filteredItems.length === 0}>
                <Printer className="h-4 w-4 mr-2" />
                Print Count Form
              </Button>
              <Button onClick={() => handleOpenModal()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </div>
          </div>

          {/* Search and Controls */}
          <div className="flex gap-4 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={expandAll}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* Low Stock Warning */}
          {lowStockCount > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
              <span className="text-yellow-800">
                <strong>{lowStockCount}</strong> item(s) below par level
              </span>
            </div>
          )}

          {/* Inventory by Category */}
          {isLoading ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-2 text-gray-500">Loading inventory...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No inventory items found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedItems).map(([category, categoryItems]) => {
                const isExpanded = expandedCategories.has(category);
                const categoryLowStock = categoryItems.filter(item => item.is_low_stock).length;

                return (
                  <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center">
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-gray-500 mr-2" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-gray-500 mr-2" />
                        )}
                        <span className="font-semibold text-gray-900">{category}</span>
                        <span className="ml-2 text-sm text-gray-500">
                          ({categoryItems.length} items)
                        </span>
                      </div>
                      {categoryLowStock > 0 && (
                        <span className="flex items-center text-yellow-600 text-sm">
                          <AlertTriangle className="h-4 w-4 mr-1" />
                          {categoryLowStock} low stock
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="divide-y divide-gray-100">
                        <table className="min-w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Stock</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Par Level</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {categoryItems.map((item) => (
                              <tr key={item.id} className={item.is_low_stock ? 'bg-yellow-50' : ''}>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className="font-medium text-gray-900">{item.name}</span>
                                  {!item.is_recurring && (
                                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">one-off</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`text-sm ${item.is_low_stock ? 'text-yellow-700 font-medium' : 'text-gray-900'}`}>
                                    {item.current_stock} {item.unit}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {item.par_level ? `${item.par_level} ${item.unit}` : '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  {item.is_low_stock ? (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                      <AlertTriangle className="h-3 w-3 mr-1" />
                                      Below Par
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      OK
                                    </span>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {item.supplier_name || '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <button onClick={() => handleOpenModal(item)} className="text-primary-600 hover:text-primary-900 mr-3">
                                    <Edit2 className="h-4 w-4" />
                                  </button>
                                  <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900">
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary */}
          {filteredItems.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
              <strong>{user?.property_name || 'Your camp'}</strong>: {filteredItems.length} total items across {Object.keys(groupedItems).length} categories
              {lowStockCount > 0 && (
                <span className="text-yellow-600 ml-2">
                  ({lowStockCount} items below par level)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Add/Edit Modal */}
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingItem ? 'Edit Item' : 'Add Item'}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="name"
              label="Item Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={formData.category || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select Category</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <Input
                id="unit"
                label="Unit"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                placeholder="gallon, lb, case, etc."
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="current_stock"
                label="Current Stock"
                type="number"
                value={formData.current_stock?.toString() || '0'}
                onChange={(e) => setFormData({ ...formData, current_stock: parseFloat(e.target.value) || 0 })}
              />
              <Input
                id="par_level"
                label="Par Level"
                type="number"
                value={formData.par_level?.toString() || ''}
                onChange={(e) => setFormData({ ...formData, par_level: e.target.value ? parseFloat(e.target.value) : null })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <select
                  value={formData.supplier_id || ''}
                  onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select Supplier</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </div>
              <Input
                id="unit_price"
                label="Unit Price ($)"
                type="number"
                step="0.01"
                value={formData.unit_price?.toString() || ''}
                onChange={(e) => setFormData({ ...formData, unit_price: e.target.value ? parseFloat(e.target.value) : null })}
              />
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_recurring ?? true}
                  onChange={(e) => setFormData({ ...formData, is_recurring: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
              <div>
                <span className="text-sm font-medium text-gray-700">Recurring Item</span>
                <p className="text-xs text-gray-500">Recurring items appear on the printed inventory count form</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" isLoading={createItem.isPending || updateItem.isPending}>
                {editingItem ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
