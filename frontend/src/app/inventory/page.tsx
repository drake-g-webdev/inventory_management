'use client';

import { useState, useRef } from 'react';
import { Plus, Search, Edit2, Trash2, AlertTriangle, Printer, ChevronDown, ChevronRight, Package, Camera, History, Upload, Loader2, X, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/authStore';
import { useInventoryItems, useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem, useInventoryCounts, useCreateInventoryCount } from '@/hooks/useInventory';
import { useSuppliers } from '@/hooks/useSuppliers';
import api from '@/lib/api';
import type { InventoryItem, CreateInventoryItemPayload, InventoryCount } from '@/types';
import toast from 'react-hot-toast';
import { UNITS, SUBCATEGORY_DEFAULT_UNITS } from '@/lib/constants';

interface ExtractedCount {
  item_id: number;
  item_name: string;
  quantity: number;
  confidence: number;
  notes?: string;
}

const CATEGORIES = ['Bakery', 'Beverages', 'Cleaning Supplies', 'Condiments', 'Dairy', 'Dry Goods', 'Frozen', 'Packaged Snacks', 'Paper & Plastic Goods', 'Produce', 'Protein', 'Spices', 'Other'];

const SUBCATEGORIES: Record<string, string[]> = {
  'Beverages': ['BIB', 'Cans/Bottles', 'Dry', 'Concentrate'],
};

// UNITS and SUBCATEGORY_DEFAULT_UNITS imported from @/lib/constants

function groupByCategory(items: InventoryItem[]) {
  return items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);
}

function groupBySubcategory(items: InventoryItem[]) {
  return items.reduce((acc, item) => {
    const subcategory = item.subcategory || 'Other';
    if (!acc[subcategory]) acc[subcategory] = [];
    acc[subcategory].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);
}

export default function InventoryPage() {
  const { user } = useAuthStore();
  const propertyId = user?.property_id || undefined;
  const { data: items = [], isLoading } = useInventoryItems(propertyId);
  const { data: suppliers = [] } = useSuppliers();
  const { data: previousCounts = [] } = useInventoryCounts(propertyId);
  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const createCount = useCreateInventoryCount();

  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSubcategories, setExpandedSubcategories] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  // Photo scanning state
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [uploadedPhotos, setUploadedPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [extractedCounts, setExtractedCounts] = useState<ExtractedCount[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Background processing state
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [processingComplete, setProcessingComplete] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [pendingPhotosCount, setPendingPhotosCount] = useState(0);

  // History state
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedCount, setSelectedCount] = useState<InventoryCount | null>(null);

  const [formData, setFormData] = useState<CreateInventoryItemPayload>({
    property_id: user?.property_id || 0,
    name: '',
    unit: 'Unit',
    order_unit: null,
    units_per_order_unit: null,
    category: '',
    subcategory: '',
    supplier_id: null,
    par_level: null,
    current_stock: 0,
    unit_price: null,
    is_recurring: true,
  });

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  // Separate recurring items from one-off items
  const recurringItems = filteredItems.filter(item => item.is_recurring !== false);
  const oneOffItems = filteredItems.filter(item => item.is_recurring === false);

  const groupedItems = groupByCategory(recurringItems);
  const lowStockCount = recurringItems.filter(item => item.is_low_stock).length;

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleSubcategory = (key: string) => {
    const newExpanded = new Set(expandedSubcategories);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedSubcategories(newExpanded);
  };

  const expandAll = () => {
    setExpandedCategories(new Set(Object.keys(groupedItems)));
    // Also expand all subcategories for categories that have them
    const allSubcategoryKeys: string[] = [];
    Object.entries(groupedItems).forEach(([category, categoryItems]) => {
      if (SUBCATEGORIES[category]) {
        const subcategoryGroups = groupBySubcategory(categoryItems);
        Object.keys(subcategoryGroups).forEach(sub => {
          allSubcategoryKeys.push(`${category}:${sub}`);
        });
      }
    });
    setExpandedSubcategories(new Set(allSubcategoryKeys));
  };

  const collapseAll = () => {
    setExpandedCategories(new Set());
    setExpandedSubcategories(new Set());
  };

  const handleOpenModal = (item?: InventoryItem) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        property_id: item.property_id,
        name: item.name,
        description: item.description,
        category: item.category || '',
        subcategory: item.subcategory || '',
        supplier_id: item.supplier_id,
        unit: item.unit,
        order_unit: item.order_unit,
        units_per_order_unit: item.units_per_order_unit,
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
        unit: 'Unit',
        order_unit: null,
        units_per_order_unit: null,
        category: '',
        subcategory: '',
        supplier_id: null,
        par_level: null,
        current_stock: 0,
        unit_price: null,
        is_recurring: true,
      });
    }
    setShowModal(true);
  };

  const handleAddItemInCategory = (category: string, subcategory?: string) => {
    setEditingItem(null);
    const defaultUnit = subcategory && SUBCATEGORY_DEFAULT_UNITS[subcategory]
      ? SUBCATEGORY_DEFAULT_UNITS[subcategory]
      : 'Unit';
    setFormData({
      property_id: user?.property_id || 0,
      name: '',
      unit: defaultUnit,
      order_unit: null,
      units_per_order_unit: null,
      category: category,
      subcategory: subcategory || '',
      supplier_id: null,
      par_level: null,
      current_stock: 0,
      unit_price: null,
      is_recurring: true,
    });
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
      // Automatically expand the category (and subcategory if applicable) for the item
      if (formData.category) {
        setExpandedCategories(prev => new Set([...Array.from(prev), formData.category!]));
        if (formData.subcategory) {
          setExpandedSubcategories(prev => new Set([...Array.from(prev), `${formData.category}:${formData.subcategory}`]));
        }
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

  const handleInlineUpdate = async (id: number, field: 'current_stock' | 'par_level', value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    try {
      await updateItem.mutateAsync({ id, data: { [field]: numValue } });
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Update failed');
    }
  };

  // Photo upload handlers
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newPhotos = [...uploadedPhotos, ...files];
    setUploadedPhotos(newPhotos);
    const newUrls = files.map(file => URL.createObjectURL(file));
    setPhotoPreviewUrls(prev => [...prev, ...newUrls]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviewUrls[index]);
    setUploadedPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllPhotos = () => {
    photoPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    setUploadedPhotos([]);
    setPhotoPreviewUrls([]);
    setExtractedCounts([]);
  };

  // Background analysis - closes modal and processes in background
  const analyzePhotosInBackground = async () => {
    if (!propertyId || uploadedPhotos.length === 0) {
      toast.error('Please upload at least one photo');
      return;
    }

    // Store photos count and close modal
    const photosToProcess = uploadedPhotos.length;
    setPendingPhotosCount(photosToProcess);
    setBackgroundProcessing(true);
    setProcessingComplete(false);
    setProcessingError(null);
    setShowPhotoModal(false);

    toast.success(`Processing ${photosToProcess} photo(s) in background. You'll be notified when ready.`);

    try {
      const formData = new FormData();
      uploadedPhotos.forEach(photo => {
        formData.append('images', photo);
      });
      const response = await api.post(`/inventory/analyze-photos?property_id=${propertyId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000, // 3 minutes for background
      });
      if (response.data.success && response.data.extracted_counts) {
        setExtractedCounts(response.data.extracted_counts);
        setProcessingComplete(true);
        toast.success(`Analysis complete! Found ${response.data.extracted_counts.length} items. Click to review.`, {
          duration: 10000,
        });
      }
    } catch (error: any) {
      let errorMessage = 'Failed to analyze photos';
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === 'string') errorMessage = detail;
        else if (typeof detail === 'object') errorMessage = detail.msg || detail.message || JSON.stringify(detail);
      }
      setProcessingError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setBackgroundProcessing(false);
    }
  };

  const openReviewModal = () => {
    setShowPhotoModal(true);
    setProcessingComplete(false);
  };

  const dismissProcessingStatus = () => {
    setProcessingComplete(false);
    setProcessingError(null);
    clearAllPhotos();
  };

  const applyExtractedCounts = async () => {
    if (!propertyId) {
      toast.error('No property assigned to your account');
      return;
    }
    const countItems = extractedCounts
      .filter(ec => ec.item_id && ec.quantity !== undefined && ec.quantity !== null)
      .map(ec => ({
        inventory_item_id: ec.item_id,
        quantity: ec.quantity,
        confidence: ec.confidence,
        notes: ec.notes || null,
      }));

    try {
      await createCount.mutateAsync({
        property_id: propertyId,
        notes: 'Scanned from photos',
        items: countItems,
      });
      toast.success('Inventory counts saved and stock levels updated!');
      setShowPhotoModal(false);
      clearAllPhotos();
    } catch (error: any) {
      let errorMessage = 'Failed to save inventory count';
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === 'string') errorMessage = detail;
        else if (Array.isArray(detail)) errorMessage = detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join(', ');
        else if (typeof detail === 'object') errorMessage = detail.msg || detail.message || JSON.stringify(detail);
      }
      toast.error(errorMessage);
    }
  };

  const viewCountHistory = (count: InventoryCount) => {
    setSelectedCount(count);
  };

  const handleExportForm = async () => {
    if (!propertyId) {
      toast.error('No property assigned');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to export the form');
      return;
    }

    // Show loading message
    printWindow.document.write('<html><body><p>Loading inventory list with AI sorting...</p></body></html>');

    try {
      // Fetch pre-sorted items from the new endpoint
      const response = await api.get(`/inventory/printable-list?property_id=${propertyId}`);
      const sortedItems = response.data.items;
      const categoriesSorted = response.data.categories_sorted || [];

      if (categoriesSorted.length > 0) {
        toast.success(`AI sorted ${categoriesSorted.length} categories with new items`);
      }

      const today = new Date().toLocaleDateString();

      // Group items by category first
      type ItemWithMeta = { id: number; name: string; category: string | null; subcategory: string | null; unit: string; par_level: number | null; current_stock: number; sort_order: number; categoryName: string; subcategoryName: string | null };
      type RowData = { type: 'category' | 'subcategory' | 'item'; content: string; item?: ItemWithMeta };

      // Build category groups with items - items are already sorted by sort_order from the backend
      const groupedByCategory = sortedItems.reduce((acc: Record<string, ItemWithMeta[]>, item: any) => {
        const cat = item.category || 'Uncategorized';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push({
          ...item,
          categoryName: cat,
          subcategoryName: item.subcategory || null,
        });
        return acc;
      }, {} as Record<string, ItemWithMeta[]>);

      // Build a flat list of rows (category headers, subcategory headers, items)
      const allRows: RowData[] = [];
      Object.keys(groupedByCategory).sort().forEach(category => {
        const items = groupedByCategory[category];
        const isBeverage = category.toLowerCase() === 'beverages' || category.toLowerCase() === 'beverage';

        // Items are already sorted by sort_order from the backend
        // For beverages with subcategories, we need to group by subcategory first
        if (isBeverage) {
          // Sort by subcategory first, then by sort_order
          items.sort((a: ItemWithMeta, b: ItemWithMeta) => {
            const subA = a.subcategoryName || 'ZZZ';
            const subB = b.subcategoryName || 'ZZZ';
            if (subA !== subB) return subA.localeCompare(subB);
            return (a.sort_order || 0) - (b.sort_order || 0);
          });
        }
        // For other categories, items are already sorted by sort_order from the backend

        // Add category header
        allRows.push({ type: 'category', content: category });

        // Add items with subcategory headers for beverages
        let currentSubcat = '';
        items.forEach((item: ItemWithMeta) => {
          if (isBeverage && item.subcategoryName && item.subcategoryName !== currentSubcat) {
            currentSubcat = item.subcategoryName;
            allRows.push({ type: 'subcategory', content: currentSubcat });
          }
          allRows.push({ type: 'item', content: item.name, item });
        });
      });

    // Simple continuous flow - just split rows into columns, no special logic
    const ROWS_PER_COLUMN = 28;

    // Split all rows into chunks of ROWS_PER_COLUMN
    const columns: RowData[][] = [];
    for (let i = 0; i < allRows.length; i += ROWS_PER_COLUMN) {
      columns.push(allRows.slice(i, i + ROWS_PER_COLUMN));
    }

    // Pair columns into pages (left + right)
    type PageData = { leftRows: RowData[]; rightRows: RowData[] };
    const pages: PageData[] = [];
    for (let i = 0; i < columns.length; i += 2) {
      pages.push({
        leftRows: columns[i] || [],
        rightRows: columns[i + 1] || [],
      });
    }

    const renderRow = (row: RowData) => {
      if (row.type === 'category') {
        return `<tr class="category-row"><td colspan="4">${row.content}</td></tr>`;
      } else if (row.type === 'subcategory') {
        return `<tr class="subcategory-row"><td colspan="4">${row.content}</td></tr>`;
      } else {
        const item = row.item!;
        return `
          <tr>
            <td class="item-name">${item.name}</td>
            <td class="unit-cell">${item.unit}</td>
            <td class="par-cell">${item.par_level || '-'}</td>
            <td class="count-cell"></td>
          </tr>
        `;
      }
    };

    const renderColumn = (rows: RowData[]) => rows.map(renderRow).join('');

    const renderPage = (page: PageData, pageNum: number, totalPages: number) => {
      return `
        <div class="page">
          <div class="header">
            <h1>Inventory Count Form</h1>
            <p><strong>${user?.property_name || 'Property'}</strong> | ${today}${totalPages > 1 ? ` | Page ${pageNum} of ${totalPages}` : ''}</p>
          </div>

          ${pageNum === 1 ? `
          <div class="info-row">
            <div class="field">
              <label>Date:</label>
              <div class="line"></div>
            </div>
            <div class="field">
              <label>Counted By:</label>
              <div class="line"></div>
            </div>
          </div>
          ` : ''}

          <div class="two-column-container">
            <div class="column">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th class="unit-cell">Unit</th>
                    <th class="par-cell">Par</th>
                    <th class="count-cell">Count</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderColumn(page.leftRows)}
                </tbody>
              </table>
            </div>
            <div class="column">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th class="unit-cell">Unit</th>
                    <th class="par-cell">Par</th>
                    <th class="count-cell">Count</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderColumn(page.rightRows)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    };

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Inventory Count Form - ${user?.property_name || 'Property'}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Arial, sans-serif;
            font-size: 13px;
            padding: 15px;
          }
          .page {
            page-break-after: always;
          }
          .page:last-child {
            page-break-after: avoid;
          }
          .header {
            text-align: center;
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 2px solid #333;
          }
          .header h1 { font-size: 20px; margin-bottom: 4px; }
          .header p { font-size: 14px; color: #666; margin: 2px 0; }
          .info-row {
            display: flex;
            gap: 30px;
            margin-bottom: 12px;
            padding: 10px;
            background: #f5f5f5;
            font-size: 13px;
          }
          .info-row .field { flex: 1; }
          .info-row label { font-weight: bold; display: block; margin-bottom: 4px; }
          .info-row .line { border-bottom: 1px solid #333; height: 22px; }

          .two-column-container {
            display: flex;
            gap: 16px;
          }
          .column {
            flex: 1;
            min-width: 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }
          th, td {
            border: 1px solid #999;
            padding: 5px 8px;
            text-align: left;
          }
          th {
            background: #e0e0e0;
            font-weight: bold;
            font-size: 12px;
          }
          .category-row td {
            background: #333;
            color: white;
            font-weight: bold;
            font-size: 13px;
            padding: 6px 8px;
          }
          .subcategory-row td {
            background: #666;
            color: white;
            font-weight: bold;
            font-size: 12px;
            padding: 4px 8px;
            font-style: italic;
          }
          .item-name {
            white-space: nowrap;
          }
          .count-cell {
            width: 60px;
            background: #fffef0;
          }
          .unit-cell { width: 55px; }
          .par-cell { width: 45px; text-align: center; }

          .footer {
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid #ccc;
            font-size: 11px;
            color: #666;
          }

          @media print {
            body { padding: 8px; }
            .no-print { display: none; }
            @page { margin: 0.3in; }
          }
        </style>
      </head>
      <body>
        ${pages.map((page, idx) => renderPage(page, idx + 1, pages.length)).join('')}

        <div class="footer">
          <p>Total: ${sortedItems.length} items</p>
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    } catch (error: any) {
      printWindow.document.write('<html><body><p style="color: red;">Error loading inventory. Please try again.</p></body></html>');
      printWindow.document.close();
      toast.error(error.response?.data?.detail || 'Failed to generate print form');
    }
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
                Print Form
              </Button>
              <Button variant="outline" onClick={() => setShowPhotoModal(true)}>
                <Camera className="h-4 w-4 mr-2" />
                Scan Photos
              </Button>
              <Button variant="outline" onClick={() => setShowHistoryModal(true)}>
                <History className="h-4 w-4 mr-2" />
                View History
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

          {/* Background Processing Status */}
          {backgroundProcessing && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center">
                <Loader2 className="h-5 w-5 text-blue-600 mr-3 animate-spin" />
                <div>
                  <span className="text-blue-800 font-medium">
                    Analyzing {pendingPhotosCount} photo(s)...
                  </span>
                  <p className="text-blue-600 text-sm">Processing in background. You can continue working.</p>
                </div>
              </div>
            </div>
          )}

          {/* Processing Complete */}
          {processingComplete && extractedCounts.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <div>
                  <span className="text-green-800 font-medium">
                    Analysis complete! Found {extractedCounts.length} items.
                  </span>
                  <p className="text-green-600 text-sm">Click "Review Results" to see the extracted counts.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={dismissProcessingStatus}>
                  Dismiss
                </Button>
                <Button size="sm" onClick={openReviewModal}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Review Results
                </Button>
              </div>
            </div>
          )}

          {/* Processing Error */}
          {processingError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-red-600 mr-3" />
                <div>
                  <span className="text-red-800 font-medium">Analysis failed</span>
                  <p className="text-red-600 text-sm">{processingError}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={dismissProcessingStatus}>
                Dismiss
              </Button>
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
                    <div className="w-full px-6 py-4 flex items-center justify-between bg-gray-50">
                      <button
                        onClick={() => toggleCategory(category)}
                        className="flex items-center flex-1 hover:bg-gray-100 -ml-2 pl-2 py-1 rounded transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-gray-500 mr-2" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-gray-500 mr-2" />
                        )}
                        <span className="font-semibold text-gray-900">{category}</span>
                        <span className="ml-2 text-sm text-gray-500">
                          ({categoryItems.length} items)
                        </span>
                        {categoryLowStock > 0 && (
                          <span className="flex items-center text-yellow-600 text-sm ml-3">
                            <AlertTriangle className="h-4 w-4 mr-1" />
                            {categoryLowStock} low stock
                          </span>
                        )}
                      </button>
                      {/* Only show Add Item button on categories without subcategories */}
                      {!SUBCATEGORIES[category] && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddItemInCategory(category);
                          }}
                          className="flex items-center text-sm text-primary-600 hover:text-primary-800 hover:bg-primary-50 px-2 py-1 rounded transition-colors"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add Item
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="divide-y divide-gray-100">
                        {/* Check if this category has subcategories */}
                        {SUBCATEGORIES[category] ? (
                          // Render with subcategory collapsibles
                          <div className="divide-y divide-gray-200">
                            {Object.entries(groupBySubcategory(categoryItems))
                              .sort(([a], [b]) => {
                                // Sort subcategories in the order defined in SUBCATEGORIES, 'Other' last
                                const order = SUBCATEGORIES[category];
                                const aIndex = order.indexOf(a);
                                const bIndex = order.indexOf(b);
                                if (a === 'Other') return 1;
                                if (b === 'Other') return -1;
                                if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
                                if (aIndex === -1) return 1;
                                if (bIndex === -1) return -1;
                                return aIndex - bIndex;
                              })
                              .map(([subcategory, subcategoryItems]) => {
                                const subKey = `${category}:${subcategory}`;
                                const isSubExpanded = expandedSubcategories.has(subKey);
                                const subLowStock = subcategoryItems.filter(item => item.is_low_stock).length;

                                return (
                                  <div key={subKey}>
                                    <div className="w-full px-6 py-3 flex items-center justify-between bg-gray-100 border-l-4 border-primary-400">
                                      <button
                                        onClick={() => toggleSubcategory(subKey)}
                                        className="flex items-center flex-1 hover:bg-gray-200 -ml-2 pl-2 py-1 rounded transition-colors"
                                      >
                                        {isSubExpanded ? (
                                          <ChevronDown className="h-4 w-4 text-gray-500 mr-2" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4 text-gray-500 mr-2" />
                                        )}
                                        <span className="font-medium text-gray-700">{subcategory}</span>
                                        <span className="ml-2 text-sm text-gray-500">
                                          ({subcategoryItems.length} items)
                                        </span>
                                        {subLowStock > 0 && (
                                          <span className="flex items-center text-yellow-600 text-xs ml-3">
                                            <AlertTriangle className="h-3 w-3 mr-1" />
                                            {subLowStock} low
                                          </span>
                                        )}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAddItemInCategory(category, subcategory);
                                        }}
                                        className="flex items-center text-sm text-primary-600 hover:text-primary-800 hover:bg-primary-50 px-2 py-1 rounded transition-colors"
                                      >
                                        <Plus className="h-4 w-4 mr-1" />
                                        Add Item
                                      </button>
                                    </div>

                                    {isSubExpanded && (
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
                                          {subcategoryItems.map((item) => (
                                            <tr key={item.id} className={item.is_low_stock ? 'bg-yellow-50' : ''}>
                                              <td className="px-6 py-4 whitespace-nowrap">
                                                <div>
                                                  <span className="font-medium text-gray-900">{item.name}</span>
                                                  {!item.is_recurring && (
                                                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">one-off</span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="number"
                                                    step="0.5"
                                                    defaultValue={item.current_stock}
                                                    onBlur={(e) => {
                                                      if (parseFloat(e.target.value) !== item.current_stock) {
                                                        handleInlineUpdate(item.id, 'current_stock', e.target.value);
                                                      }
                                                    }}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') {
                                                        (e.target as HTMLInputElement).blur();
                                                      }
                                                    }}
                                                    className={`w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${item.is_low_stock ? 'text-yellow-700 font-medium' : 'text-gray-900'}`}
                                                  />
                                                  <span className="text-xs text-gray-500">{item.unit}</span>
                                                </div>
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="number"
                                                    step="0.5"
                                                    defaultValue={item.par_level ?? ''}
                                                    placeholder="-"
                                                    onBlur={(e) => {
                                                      const newVal = e.target.value === '' ? null : parseFloat(e.target.value);
                                                      if (newVal !== item.par_level) {
                                                        handleInlineUpdate(item.id, 'par_level', e.target.value);
                                                      }
                                                    }}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') {
                                                        (e.target as HTMLInputElement).blur();
                                                      }
                                                    }}
                                                    className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-gray-500"
                                                  />
                                                  <span className="text-xs text-gray-500">{item.unit}</span>
                                                </div>
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
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          // No subcategories - render flat table
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
                                    <div>
                                      <span className="font-medium text-gray-900">{item.name}</span>
                                      {!item.is_recurring && (
                                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">one-off</span>
                                      )}
                                    </div>
                                    {item.subcategory && (
                                      <span className="text-xs text-gray-500">{item.subcategory}</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        step="0.5"
                                        defaultValue={item.current_stock}
                                        onBlur={(e) => {
                                          if (parseFloat(e.target.value) !== item.current_stock) {
                                            handleInlineUpdate(item.id, 'current_stock', e.target.value);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLInputElement).blur();
                                          }
                                        }}
                                        className={`w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 ${item.is_low_stock ? 'text-yellow-700 font-medium' : 'text-gray-900'}`}
                                      />
                                      <span className="text-xs text-gray-500">{item.unit}</span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        step="0.5"
                                        defaultValue={item.par_level ?? ''}
                                        placeholder="-"
                                        onBlur={(e) => {
                                          const newVal = e.target.value === '' ? null : parseFloat(e.target.value);
                                          if (newVal !== item.par_level) {
                                            handleInlineUpdate(item.id, 'par_level', e.target.value);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLInputElement).blur();
                                          }
                                        }}
                                        className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-gray-500"
                                      />
                                      <span className="text-xs text-gray-500">{item.unit}</span>
                                    </div>
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
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* One-Off Items Section */}
          {oneOffItems.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden border-2 border-dashed border-gray-300">
              <div className="w-full px-6 py-4 flex items-center justify-between bg-gray-100">
                <button
                  onClick={() => toggleCategory('__one_off__')}
                  className="flex items-center flex-1 hover:bg-gray-200 -ml-2 pl-2 py-1 rounded transition-colors"
                >
                  {expandedCategories.has('__one_off__') ? (
                    <ChevronDown className="h-5 w-5 text-gray-500 mr-2" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-500 mr-2" />
                  )}
                  <span className="font-semibold text-gray-700">One-Off Items</span>
                  <span className="ml-2 text-sm text-gray-500">
                    ({oneOffItems.length} items)
                  </span>
                  <span className="ml-3 px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">
                    Not on inventory form
                  </span>
                </button>
              </div>

              {expandedCategories.has('__one_off__') && (
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {oneOffItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-medium text-gray-900">{item.name}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.category || 'Uncategorized'}
                          {item.subcategory && <span className="text-gray-400 ml-1">/ {item.subcategory}</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.unit}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.supplier_name || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <button
                            onClick={() => handleOpenModal(item)}
                            className="text-primary-600 hover:text-primary-800 mr-3"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Summary */}
          {filteredItems.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
              <strong>{user?.property_name || 'Your camp'}</strong>: {filteredItems.length} total items across {Object.keys(groupedItems).length} categories
              {oneOffItems.length > 0 && (
                <span className="text-gray-500 ml-2">
                  + {oneOffItems.length} one-off item{oneOffItems.length !== 1 ? 's' : ''}
                </span>
              )}
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
                  onChange={(e) => setFormData({ ...formData, category: e.target.value, subcategory: '' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select Category</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
{formData.category && SUBCATEGORIES[formData.category] ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subcategory</label>
                  <select
                    value={formData.subcategory || ''}
                    onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select Subcategory</option>
                    {SUBCATEGORIES[formData.category].map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div></div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                >
                  {UNITS.map(unit => (
                    <option key={unit} value={unit}>{unit}</option>
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
            {/* Order Unit Configuration */}
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm font-medium text-blue-800 mb-2">Ordering Unit (Optional)</p>
              <p className="text-xs text-blue-600 mb-3">
                If you count in one unit but order in another (e.g., count boxes, order cases), configure here.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Order Unit</label>
                  <select
                    value={formData.order_unit || ''}
                    onChange={(e) => setFormData({ ...formData, order_unit: e.target.value || null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                  >
                    <option value="">Same as counting unit</option>
                    {UNITS.map(unit => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {formData.unit}s per {formData.order_unit || 'order unit'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.units_per_order_unit?.toString() || ''}
                    onChange={(e) => setFormData({ ...formData, units_per_order_unit: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="e.g., 8"
                    disabled={!formData.order_unit}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
              </div>
              {formData.order_unit && formData.units_per_order_unit && (
                <p className="text-xs text-blue-700 mt-2">
                  Example: 1 {formData.order_unit} = {formData.units_per_order_unit} {formData.unit}(s)
                </p>
              )}
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

        {/* Photo Upload Modal */}
        <Modal
          isOpen={showPhotoModal}
          onClose={() => { setShowPhotoModal(false); }}
          title="Scan Inventory Count Sheets"
          size="lg"
        >
          <div className="space-y-6">
            {/* Instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Camera className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm text-blue-800 font-medium">How to use AI Photo Analysis</p>
                  <ol className="text-sm text-blue-700 mt-2 list-decimal list-inside space-y-1">
                    <li>Take clear photos of your filled inventory count sheets</li>
                    <li>Upload all pages (you can upload multiple photos)</li>
                    <li>Click "Analyze Photos" to extract counts using AI</li>
                    <li>Review the extracted counts and apply them to update stock</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.heic,.heif,.pdf,application/pdf"
              multiple
              onChange={handlePhotoSelect}
              className="hidden"
            />

            {/* Upload area */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-gray-50 transition-colors"
            >
              <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 font-medium">Click to upload photos or PDF</p>
              <p className="text-gray-400 text-sm mt-1">PNG, JPG, WEBP, HEIC, PDF supported. Multiple files allowed.</p>
            </div>

            {/* Photo previews */}
            {uploadedPhotos.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Uploaded Files ({uploadedPhotos.length})</h4>
                  <button onClick={clearAllPhotos} className="text-sm text-red-600 hover:text-red-700">
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {uploadedPhotos.map((file, index) => {
                    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                    return (
                      <div key={index} className="relative group">
                        {isPdf ? (
                          <div className="w-full h-32 bg-red-50 rounded-lg border border-red-200 flex flex-col items-center justify-center">
                            <FileText className="h-10 w-10 text-red-500 mb-1" />
                            <span className="text-xs text-gray-600 text-center px-2 truncate w-full">{file.name}</span>
                          </div>
                        ) : (
                          <img src={photoPreviewUrls[index]} alt={`Uploaded photo ${index + 1}`} className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                        )}
                        <button
                          onClick={() => removePhoto(index)}
                          className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <span className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                          {isPdf ? 'PDF' : `Photo ${index + 1}`}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Analyze button */}
                <Button
                  onClick={analyzePhotosInBackground}
                  disabled={backgroundProcessing || uploadedPhotos.length === 0}
                  className="w-full"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Analyze Files ({uploadedPhotos.length})
                </Button>
              </div>
            )}

            {/* Extracted counts */}
            {extractedCounts.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <h4 className="font-medium text-gray-900">Extracted Counts ({extractedCounts.length} items)</h4>
                </div>

                <div className="max-h-96 overflow-y-auto border rounded-lg divide-y divide-gray-200">
                  {extractedCounts.map((ec, index) => (
                    <div key={index} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{ec.item_name}</p>
                        {ec.notes && <p className="text-xs text-gray-500 mt-1 truncate">{ec.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={ec.quantity}
                          onChange={(e) => {
                            const newCounts = [...extractedCounts];
                            newCounts[index] = { ...newCounts[index], quantity: parseFloat(e.target.value) || 0 };
                            setExtractedCounts(newCounts);
                          }}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-center font-semibold focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                        <div className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                          ec.confidence >= 0.8 ? 'bg-green-100 text-green-700' :
                          ec.confidence >= 0.5 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {Math.round(ec.confidence * 100)}%
                        </div>
                        <button
                          onClick={() => {
                            const newCounts = extractedCounts.filter((_, i) => i !== index);
                            setExtractedCounts(newCounts);
                          }}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                          title="Remove item"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Low confidence warning */}
                {extractedCounts.some(ec => ec.confidence < 0.8) && (
                  <div className="flex items-start gap-2 text-amber-600 text-sm bg-amber-50 p-3 rounded-lg">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    <p>Some items have low confidence scores. Please review these counts carefully before applying.</p>
                  </div>
                )}

                {/* Apply button */}
                <Button onClick={applyExtractedCounts} className="w-full" isLoading={createCount.isPending}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Apply Counts & Update Stock
                </Button>
              </div>
            )}
          </div>
        </Modal>

        {/* History Modal */}
        <Modal
          isOpen={showHistoryModal}
          onClose={() => { setShowHistoryModal(false); setSelectedCount(null); }}
          title={selectedCount ? `Count Details - ${new Date(selectedCount.count_date).toLocaleDateString()}` : 'Count History'}
          size="lg"
        >
          {selectedCount ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">{new Date(selectedCount.count_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Counted By</p>
                  <p className="font-medium">{selectedCount.counted_by_name || 'Unknown'}</p>
                </div>
                {selectedCount.notes && (
                  <div className="col-span-2">
                    <p className="text-sm text-gray-500">Notes</p>
                    <p className="font-medium">{selectedCount.notes}</p>
                  </div>
                )}
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Counted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {selectedCount.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2 text-sm font-medium">{item.item_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{item.unit}</td>
                        <td className="px-4 py-2 text-sm text-right">{item.counted_quantity ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button variant="outline" onClick={() => setSelectedCount(null)} className="w-full">
                Back to History
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {previousCounts.length === 0 ? (
                <div className="text-center py-8">
                  <History className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No previous counts found</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {previousCounts.slice(0, 10).map((count) => (
                    <button
                      key={count.id}
                      onClick={() => viewCountHistory(count)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {new Date(count.count_date).toLocaleDateString()}
                        </p>
                        <p className="text-sm text-gray-500">
                          By {count.counted_by_name || 'Unknown'} - {count.items?.length || 0} items
                        </p>
                        {count.notes && (
                          <p className="text-sm text-gray-400 truncate max-w-md">{count.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center">
                        {count.is_complete && (
                          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                        )}
                        <span className="text-primary-600 text-sm">View Details</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
