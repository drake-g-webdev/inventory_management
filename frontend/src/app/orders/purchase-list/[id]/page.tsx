'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Truck, Package, Mail, Phone, ChevronDown, ChevronUp, FileDown, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import { useSupplierPurchaseList, useOrder } from '@/hooks/useOrders';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import type { SupplierPurchaseGroup } from '@/types';

function SupplierCard({ supplier, defaultExpanded = false, showPricing = true }: { supplier: SupplierPurchaseGroup; defaultExpanded?: boolean; showPricing?: boolean }) {
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
            {showPricing && (
              <p className="text-lg font-semibold text-gray-900">{formatCurrency(supplier.total_value)}</p>
            )}
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
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                {showPricing && (
                  <>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Price</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Line Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {supplier.items.map((item, idx) => (
                <tr key={`${item.order_id}-${item.item_id}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-start">
                      <Package className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                      <div>
                        <span className="font-medium text-gray-900">
                          {item.item_name}
                          {item.qty && <span className="text-gray-500 ml-1">- {item.qty}</span>}
                        </span>
                        {item.brand && (
                          <span className="ml-2 text-sm text-purple-600 font-medium">({item.brand})</span>
                        )}
                        {item.product_notes && (
                          <p className="text-xs text-gray-500 mt-0.5">{item.product_notes}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                    {item.quantity} {item.unit}
                  </td>
                  {showPricing && (
                    <>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                        {item.unit_price ? formatCurrency(item.unit_price) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                        {item.line_total ? formatCurrency(item.line_total) : '-'}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {showPricing && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-6 py-3 text-right text-sm font-medium text-gray-900">
                    Supplier Total:
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">
                    {formatCurrency(supplier.total_value)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

export default function OrderPurchaseListPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = Number(params.id);

  const { data: order, isLoading: orderLoading } = useOrder(orderId);
  const { data: purchaseList, isLoading, error } = useSupplierPurchaseList([orderId]);
  const { user } = useAuthStore();

  // Only show pricing for purchasing supervisors, not purchasing team
  const showPricing = user?.role !== 'purchasing_team';

  const handleExportPDF = () => {
    if (!purchaseList || purchaseList.suppliers.length === 0 || !order) return;

    const today = new Date().toLocaleDateString();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      return;
    }

    // Group items by category within a supplier
    const groupItemsByCategory = (items: typeof purchaseList.suppliers[0]['items']) => {
      const grouped: Record<string, typeof items> = {};
      items.forEach(item => {
        const category = item.category || 'Other';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(item);
      });
      return grouped;
    };

    const renderSupplierSection = (supplier: SupplierPurchaseGroup) => {
      const groupedItems = groupItemsByCategory(supplier.items);
      const categories = Object.keys(groupedItems).sort();

      return `
        <div class="supplier-section">
          <div class="supplier-header">
            <div class="supplier-name">${supplier.supplier_name}</div>
            <div class="supplier-count">${supplier.total_items} items</div>
          </div>
          <table class="items-table">
            <thead>
              <tr>
                <th class="item-col">Item</th>
                <th class="qty-col">Qty</th>
                <th class="unit-col">Unit</th>
              </tr>
            </thead>
            <tbody>
              ${categories.map(category => `
                <tr class="category-row">
                  <td colspan="3">${category}</td>
                </tr>
                ${groupedItems[category].map(item => `
                  <tr>
                    <td class="item-col">
                      ${item.item_name}${item.qty ? ` - ${item.qty}` : ''}${item.brand ? ` <span class="brand">(${item.brand})</span>` : ''}
                      ${item.product_notes ? `<div class="product-notes">${item.product_notes}</div>` : ''}
                    </td>
                    <td class="qty-col">${item.quantity}</td>
                    <td class="unit-col">${item.unit}</td>
                  </tr>
                `).join('')}
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Purchase List - ${order.property_name} - ${new Date(order.week_of).toLocaleDateString()}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Arial, sans-serif;
            font-size: 14px;
            line-height: 1.4;
            padding: 20px;
            color: #000;
          }
          .header {
            text-align: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid #333;
          }
          .header h1 { font-size: 28px; margin-bottom: 8px; }
          .header .property-name { font-size: 20px; font-weight: bold; color: #2563eb; margin-bottom: 8px; }
          .header p { font-size: 14px; color: #000; }
          .summary {
            display: flex;
            justify-content: space-between;
            margin-bottom: 24px;
            padding: 16px;
            background: #f5f5f5;
            border-radius: 6px;
          }
          .summary-item {
            text-align: center;
          }
          .summary-item .label { font-size: 12px; color: #000; }
          .summary-item .value { font-size: 20px; font-weight: bold; }
          .supplier-section {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }
          .supplier-header {
            background: #2563eb;
            color: white;
            padding: 10px 16px;
            border-radius: 4px 4px 0 0;
          }
          .supplier-name {
            font-size: 18px;
            font-weight: bold;
          }
          .supplier-count {
            font-size: 14px;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
          }
          .items-table th, .items-table td {
            border: 1px solid #ddd;
            padding: 10px 12px;
            text-align: left;
          }
          .items-table th {
            background: #f0f0f0;
            font-weight: bold;
            font-size: 12px;
            text-transform: uppercase;
          }
          .category-row td {
            background: #374151;
            color: white;
            font-weight: bold;
            font-size: 14px;
            padding: 8px 12px;
            text-align: left;
          }
          .item-col { width: 60%; padding-left: 20px !important; }
          .brand { color: #7c3aed; font-weight: 500; font-size: 12px; }
          .product-notes { color: #6b7280; font-size: 11px; margin-top: 2px; }
          .qty-col { width: 20%; text-align: center; }
          .unit-col { width: 20%; text-align: center; }
          .footer {
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid #ccc;
            font-size: 12px;
            color: #000;
            text-align: center;
          }
          @media print {
            body { padding: 15px; }
            @page { margin: 0.5in; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Purchase List</h1>
          <p class="property-name">${order.property_name}</p>
          <p>Week of: ${new Date(order.week_of).toLocaleDateString()} | Generated: ${today}</p>
        </div>

        <div class="summary">
          <div class="summary-item">
            <div class="label">Suppliers</div>
            <div class="value">${purchaseList.suppliers.length}</div>
          </div>
          <div class="summary-item">
            <div class="label">Total Items</div>
            <div class="value">${purchaseList.suppliers.reduce((sum, s) => sum + s.total_items, 0)}</div>
          </div>
        </div>

        ${purchaseList.suppliers.map(supplier => renderSupplierSection(supplier)).join('')}

        <div class="footer">
          <p>Sukakpak Purchasing Support System | Printed ${today}</p>
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

  if (orderLoading || isLoading) {
    return (
      <RoleGuard allowedRoles={['purchasing_supervisor', 'purchasing_team']}>
        <DashboardLayout>
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500">Loading purchase list...</p>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  if (!order) {
    return (
      <RoleGuard allowedRoles={['purchasing_supervisor', 'purchasing_team']}>
        <DashboardLayout>
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <p className="text-red-600">Order not found</p>
            <Link href="/orders/all" className="text-primary-600 hover:underline mt-2 inline-block">
              Back to All Orders
            </Link>
          </div>
        </DashboardLayout>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allowedRoles={['purchasing_supervisor', 'purchasing_team']}>
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Link href="/orders/all" className="text-gray-500 hover:text-gray-700">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <h1 className="text-2xl font-bold text-gray-900">Purchase List</h1>
              </div>
              <p className="text-gray-500">
                <span className="font-medium text-gray-500">{order.property_name}</span>
                {' '}&mdash; Week of {new Date(order.week_of).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2 print:hidden">
              <button
                onClick={handleExportPDF}
                disabled={!purchaseList || purchaseList.suppliers.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileDown className="h-4 w-4" />
                Export PDF
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          {purchaseList && (
            <div className={`grid grid-cols-1 ${showPricing ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4 print:hidden`}>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Total Suppliers</p>
                <p className="text-3xl font-bold text-gray-900">{purchaseList.suppliers.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Total Items</p>
                <p className="text-3xl font-bold text-gray-900">
                  {purchaseList.suppliers.reduce((sum, s) => sum + s.total_items, 0)}
                </p>
              </div>
              {showPricing && (
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <p className="text-sm text-gray-500">Grand Total</p>
                  <p className="text-3xl font-bold text-primary-600">{formatCurrency(purchaseList.grand_total)}</p>
                </div>
              )}
            </div>
          )}

          {/* Supplier List */}
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-600">Failed to load purchase list</p>
            </div>
          ) : purchaseList?.suppliers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <Truck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No items to purchase for this order</p>
            </div>
          ) : (
            <div className="space-y-4">
              {purchaseList?.suppliers.map((supplier, idx) => (
                <SupplierCard
                  key={supplier.supplier_id || `no-supplier-${idx}`}
                  supplier={supplier}
                  defaultExpanded={idx === 0}
                  showPricing={showPricing}
                />
              ))}
            </div>
          )}

          {/* Grand Total Footer - Only show for roles that can see pricing */}
          {showPricing && purchaseList && purchaseList.suppliers.length > 0 && (
            <div className="bg-primary-50 border border-primary-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary-600">Grand Total - All Suppliers</p>
                  <p className="text-sm text-primary-500">
                    {purchaseList.suppliers.length} suppliers
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
