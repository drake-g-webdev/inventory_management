'use client';

import { useState } from 'react';
import { Truck, Package, Mail, Phone, Building2, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Badge from '@/components/ui/Badge';
import { useSupplierPurchaseList } from '@/hooks/useOrders';
import { formatCurrency } from '@/lib/utils';
import type { SupplierPurchaseGroup } from '@/types';

function SupplierCard({ supplier, defaultExpanded = false }: { supplier: SupplierPurchaseGroup; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Supplier Header */}
      <div
        className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg bg-primary-100 flex items-center justify-center">
            <Truck className="h-6 w-6 text-primary-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{supplier.supplier_name}</h3>
            <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
              {supplier.contact_name && (
                <span>{supplier.contact_name}</span>
              )}
              {supplier.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {supplier.email}
                </span>
              )}
              {supplier.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {supplier.phone}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-sm text-gray-500">{supplier.total_items} items</p>
            <p className="text-lg font-semibold text-gray-900">{formatCurrency(supplier.total_value)}</p>
          </div>
          {expanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Items Table - Expanded */}
      {expanded && (
        <div className="border-t border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order #</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Price</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Line Total</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {supplier.items.map((item, idx) => (
                <tr key={`${item.order_id}-${item.item_id}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Package className="h-4 w-4 text-gray-400 mr-2" />
                      <span className="font-medium text-gray-900">{item.item_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-500">
                      <Building2 className="h-4 w-4 mr-1" />
                      {item.property_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.order_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                    {item.unit_price ? formatCurrency(item.unit_price) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                    {item.line_total ? formatCurrency(item.line_total) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={5} className="px-6 py-3 text-right text-sm font-medium text-gray-900">
                  Supplier Total:
                </td>
                <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">
                  {formatCurrency(supplier.total_value)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PurchaseListPage() {
  const { data: purchaseList, isLoading, error } = useSupplierPurchaseList();

  const handlePrint = () => {
    window.print();
  };

  return (
    <RoleGuard allowedRoles={['purchasing_supervisor', 'purchasing_team']}>
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Purchase List by Supplier</h1>
              <p className="text-gray-500 mt-1">Items from approved orders grouped by supplier</p>
            </div>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors print:hidden"
            >
              <Printer className="h-4 w-4" />
              Print List
            </button>
          </div>

          {/* Summary Cards */}
          {purchaseList && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Total Suppliers</p>
                <p className="text-3xl font-bold text-gray-900">{purchaseList.suppliers.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Approved Orders</p>
                <p className="text-3xl font-bold text-gray-900">{purchaseList.total_orders}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Grand Total</p>
                <p className="text-3xl font-bold text-primary-600">{formatCurrency(purchaseList.grand_total)}</p>
              </div>
            </div>
          )}

          {/* Supplier List */}
          {isLoading ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-500">Loading purchase list...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-600">Failed to load purchase list</p>
            </div>
          ) : purchaseList?.suppliers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <Truck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No approved orders to purchase</p>
              <p className="text-sm text-gray-400 mt-1">Approve orders to see them here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {purchaseList?.suppliers.map((supplier, idx) => (
                <SupplierCard
                  key={supplier.supplier_id || `no-supplier-${idx}`}
                  supplier={supplier}
                  defaultExpanded={idx === 0}
                />
              ))}
            </div>
          )}

          {/* Grand Total Footer */}
          {purchaseList && purchaseList.suppliers.length > 0 && (
            <div className="bg-primary-50 border border-primary-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary-600">Grand Total - All Suppliers</p>
                  <p className="text-sm text-primary-500">
                    {purchaseList.total_orders} orders across {purchaseList.suppliers.length} suppliers
                  </p>
                </div>
                <p className="text-3xl font-bold text-primary-700">{formatCurrency(purchaseList.grand_total)}</p>
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
