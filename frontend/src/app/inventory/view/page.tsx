'use client';

import { useState } from 'react';
import { Search, ChevronDown, ChevronRight, AlertTriangle, Package } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import { useProperties } from '@/hooks/useProperties';
import { useInventoryItems } from '@/hooks/useInventory';
import type { InventoryItem } from '@/types';

const CATEGORIES = ['Dairy', 'Protein', 'Produce', 'Dry Goods', 'Canned/Jarred', 'Beverages', 'Condiments', 'Other'];

function groupByCategory(items: InventoryItem[]) {
  return items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);
}

export default function InventoryViewPage() {
  const { data: properties = [], isLoading: propertiesLoading } = useProperties();
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const { data: items = [], isLoading: itemsLoading } = useInventoryItems(selectedPropertyId || undefined);

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

  const expandAll = () => setExpandedCategories(new Set(CATEGORIES));
  const collapseAll = () => setExpandedCategories(new Set());

  const selectedProperty = properties.find(p => p.id === selectedPropertyId);

  return (
    <RoleGuard allowedRoles={['purchasing_supervisor', 'admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Camp Inventory</h1>
              <p className="text-gray-500 mt-1">View inventory counts for each camp</p>
            </div>
          </div>

          {/* Property Selector */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Camp
            </label>
            <select
              value={selectedPropertyId || ''}
              onChange={(e) => setSelectedPropertyId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              disabled={propertiesLoading}
            >
              <option value="">-- Select a camp --</option>
              {properties.map(property => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>

          {selectedPropertyId && (
            <>
              {/* Search and Stats */}
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
                    <strong>{lowStockCount}</strong> item(s) below par level at {selectedProperty?.name}
                  </span>
                </div>
              )}

              {/* Inventory by Category */}
              {itemsLoading ? (
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
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order At</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {categoryItems.map((item) => (
                                  <tr key={item.id} className={item.is_low_stock ? 'bg-yellow-50' : ''}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <span className="font-medium text-gray-900">
                                        {item.name}
                                        {item.qty && <span className="text-gray-500 ml-1">- {item.qty}</span>}
                                      </span>
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
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      {item.order_at ? `${item.order_at} ${item.unit}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      {item.is_low_stock ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                          <AlertTriangle className="h-3 w-3 mr-1" />
                                          Needs Order
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
                  <strong>{selectedProperty?.name}</strong>: {filteredItems.length} total items across {Object.keys(groupedItems).length} categories
                  {lowStockCount > 0 && (
                    <span className="text-yellow-600 ml-2">
                      ({lowStockCount} items below par level)
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
