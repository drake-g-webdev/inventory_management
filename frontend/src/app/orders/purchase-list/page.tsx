'use client';

import { useState } from 'react';
import { Truck, Package, Mail, Phone, Building2, ChevronDown, ChevronUp, FileDown, AlertTriangle } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Badge from '@/components/ui/Badge';
import { useSupplierPurchaseList, useUnreceivedItems } from '@/hooks/useOrders';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import type { SupplierPurchaseGroup, SupplierPurchaseItem, UnreceivedItem } from '@/types';

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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order #</th>
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
                  <td colSpan={5} className="px-6 py-3 text-right text-sm font-medium text-gray-900">
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

function UnreceivedItemsSection({ items }: { items: UnreceivedItem[] }) {
  const [expanded, setExpanded] = useState(true);

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-orange-50 border-2 border-orange-400 rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between cursor-pointer bg-orange-500 text-white"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6" />
          <div>
            <h3 className="text-lg font-semibold">Items Not Received from Previous Orders</h3>
            <p className="text-orange-100 text-sm">These items were ordered but not fully received</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="warning" className="bg-white text-orange-600">
            {items.length} items
          </Badge>
          {expanded ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </div>
      </div>

      {/* Items Table - Expanded */}
      {expanded && (
        <div>
          <table className="min-w-full divide-y divide-orange-200">
            <thead className="bg-orange-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-orange-800 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-orange-800 uppercase tracking-wider">From Orders</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-orange-800 uppercase tracking-wider">Property</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-orange-800 uppercase tracking-wider">Total Shortage</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-orange-100">
              {items.map((item, index) => (
                <tr key={item.inventory_item_id || `custom-${index}`} className="hover:bg-orange-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Package className="h-4 w-4 text-orange-400 mr-2" />
                      <span className="font-medium text-gray-900">{item.item_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {item.order_count > 1 ? (
                      <span>{item.order_count} orders</span>
                    ) : (
                      <span>{item.latest_order_number}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-500">
                      <Building2 className="h-4 w-4 mr-1" />
                      {item.property_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                      {item.total_shortage} {item.unit}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PurchaseListPage() {
  const { data: purchaseList, isLoading, error } = useSupplierPurchaseList();
  const { user } = useAuthStore();
  const { data: unreceivedData } = useUnreceivedItems(user?.property_id || undefined);

  // Only show pricing for purchasing supervisors, not purchasing team
  const showPricing = user?.role !== 'purchasing_team';

  const handleExportPDF = () => {
    if (!purchaseList || purchaseList.suppliers.length === 0) return;

    const today = new Date().toLocaleDateString();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      return;
    }

    const formatCurrencyForPdf = (amount: number) => {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    // Group items by category within a supplier
    const groupItemsByCategory = (items: SupplierPurchaseItem[]) => {
      const grouped: Record<string, SupplierPurchaseItem[]> = {};
      items.forEach(item => {
        const category = item.category || 'Other';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(item);
      });
      return grouped;
    };

    const renderUnreceivedItemsSection = () => {
      const items = unreceivedData?.items || [];
      if (items.length === 0) return '';

      return `
        <div class="unreceived-section">
          <div class="unreceived-header">
            <div class="unreceived-title">⚠️ Items Not Received from Previous Orders</div>
            <div class="unreceived-count">${items.length} items</div>
          </div>
          <table class="items-table">
            <thead>
              <tr>
                <th class="item-col">Item</th>
                <th class="order-col">From Orders</th>
                <th class="qty-col shortage-col">Total Shortage</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr>
                  <td class="item-col">${item.item_name}</td>
                  <td class="order-col">${item.order_count > 1 ? `${item.order_count} orders` : item.latest_order_number || ''}</td>
                  <td class="qty-col shortage-col">${item.total_shortage} ${item.unit || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
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
        <title>Purchase List by Supplier - ${today}</title>
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
          .order-col { width: 15%; text-align: center; }
          .shortage-col { background: #fff7ed !important; color: #c2410c !important; font-weight: bold !important; }
          .unreceived-section {
            margin-bottom: 24px;
            page-break-inside: avoid;
            border: 2px solid #f97316;
            border-radius: 4px;
          }
          .unreceived-header {
            background: #f97316;
            color: white;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .unreceived-title {
            font-size: 18px;
            font-weight: bold;
          }
          .unreceived-count {
            font-size: 14px;
          }
          .unreceived-section .items-table th {
            background: #ffedd5;
          }
          .unreceived-section .items-table tr:hover {
            background: #fff7ed;
          }
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
          <h1>Purchase List by Supplier</h1>
          <p class="property-name">${purchaseList.suppliers[0]?.items[0]?.property_name || 'All Properties'}</p>
          <p>Generated: ${today} | ${purchaseList.total_orders} Orders | ${purchaseList.suppliers.length} Suppliers</p>
        </div>

        <div class="summary">
          <div class="summary-item">
            <div class="label">Suppliers</div>
            <div class="value">${purchaseList.suppliers.length}</div>
          </div>
          <div class="summary-item">
            <div class="label">Orders</div>
            <div class="value">${purchaseList.total_orders}</div>
          </div>
          <div class="summary-item">
            <div class="label">Total Items</div>
            <div class="value">${purchaseList.suppliers.reduce((sum, s) => sum + s.total_items, 0)}</div>
          </div>
        </div>

        ${renderUnreceivedItemsSection()}

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
                <p className="text-sm text-gray-500">Approved Orders</p>
                <p className="text-3xl font-bold text-gray-900">{purchaseList.total_orders}</p>
              </div>
              {showPricing && (
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <p className="text-sm text-gray-500">Grand Total</p>
                  <p className="text-3xl font-bold text-primary-600">{formatCurrency(purchaseList.grand_total)}</p>
                </div>
              )}
            </div>
          )}

          {/* Unreceived Items from Previous Orders */}
          {unreceivedData && unreceivedData.items.length > 0 && (
            <UnreceivedItemsSection items={unreceivedData.items} />
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
