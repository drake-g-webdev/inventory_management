'use client';

import { useState, useEffect, useRef } from 'react';
import { Save, History, Calculator, CheckCircle, Camera, X, Upload, Loader2, AlertCircle, Printer } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useInventoryItems, useInventoryCounts, useCreateInventoryCount } from '@/hooks/useInventory';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import type { InventoryItem, InventoryCount } from '@/types';
import toast from 'react-hot-toast';

interface ExtractedCount {
  item_id: number;
  item_name: string;
  quantity: number;
  confidence: number;
  notes?: string;
}

export default function InventoryCountPage() {
  const { user } = useAuthStore();
  const propertyId = user?.property_id || undefined;

  const { data: inventoryItems = [], isLoading: itemsLoading } = useInventoryItems(propertyId);
  const { data: previousCounts = [], isLoading: countsLoading } = useInventoryCounts(propertyId);
  const createCount = useCreateInventoryCount();

  const [counts, setCounts] = useState<Record<number, number | null>>({});
  const [notes, setNotes] = useState('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedCount, setSelectedCount] = useState<InventoryCount | null>(null);

  // Photo upload state
  const [uploadedPhotos, setUploadedPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedCounts, setExtractedCounts] = useState<ExtractedCount[]>([]);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group items by category
  const groupedItems = inventoryItems.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);

  // Initialize counts with current stock values
  useEffect(() => {
    if (inventoryItems.length > 0 && Object.keys(counts).length === 0) {
      const initialCounts: Record<number, number | null> = {};
      inventoryItems.forEach(item => {
        initialCounts[item.id] = item.current_stock;
      });
      setCounts(initialCounts);
    }
  }, [inventoryItems]);

  const handleCountChange = (itemId: number, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setCounts(prev => ({ ...prev, [itemId]: numValue }));
  };

  const handleSubmit = async () => {
    if (!propertyId) {
      toast.error('No property assigned to your account');
      return;
    }

    const items = Object.entries(counts)
      .filter(([, qty]) => qty !== null)
      .map(([id, qty]) => ({
        inventory_item_id: parseInt(id),
        quantity: qty as number,
      }));

    try {
      await createCount.mutateAsync({
        property_id: propertyId,
        notes: notes || undefined,
        items,
      });
      toast.success('Inventory count saved successfully!');
      setNotes('');
    } catch (error: any) {
      let errorMessage = 'Failed to save inventory count';
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === 'string') {
          errorMessage = detail;
        } else if (Array.isArray(detail)) {
          // Pydantic validation errors
          errorMessage = detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join(', ');
        } else if (typeof detail === 'object') {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        }
      }
      toast.error(errorMessage);
    }
  };

  const viewCountHistory = (count: InventoryCount) => {
    setSelectedCount(count);
    setShowHistoryModal(true);
  };

  // Photo upload handlers
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Add new files to existing ones
    const newPhotos = [...uploadedPhotos, ...files];
    setUploadedPhotos(newPhotos);

    // Generate preview URLs for new files
    const newUrls = files.map(file => URL.createObjectURL(file));
    setPhotoPreviewUrls(prev => [...prev, ...newUrls]);

    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removePhoto = (index: number) => {
    // Revoke the URL to prevent memory leaks
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

  const analyzePhotos = async () => {
    if (!propertyId || uploadedPhotos.length === 0) {
      toast.error('Please upload at least one photo');
      return;
    }

    setIsAnalyzing(true);
    setExtractedCounts([]);

    try {
      const formData = new FormData();
      uploadedPhotos.forEach(photo => {
        formData.append('images', photo);
      });

      const response = await api.post(`/inventory/analyze-photos?property_id=${propertyId}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120000, // 2 minute timeout for AI analysis
      });

      if (response.data.success && response.data.extracted_counts) {
        setExtractedCounts(response.data.extracted_counts);
        toast.success(`Analyzed ${response.data.images_processed} photo(s). Found ${response.data.extracted_counts.length} items.`);
      }
    } catch (error: any) {
      let errorMessage = 'Failed to analyze photos';
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === 'string') {
          errorMessage = detail;
        } else if (typeof detail === 'object') {
          errorMessage = detail.msg || detail.message || JSON.stringify(detail);
        }
      }
      toast.error(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyExtractedCounts = () => {
    const newCounts = { ...counts };
    extractedCounts.forEach(ec => {
      if (ec.item_id && ec.quantity !== undefined) {
        newCounts[ec.item_id] = ec.quantity;
      }
    });
    setCounts(newCounts);
    setShowPhotoModal(false);
    toast.success('Applied extracted counts to inventory form');
  };

  const handlePrintForm = () => {
    const today = new Date().toLocaleDateString();

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to print the form');
      return;
    }

    // Flatten all items into a single list for two-column layout
    const allItems = Object.entries(groupedItems).flatMap(([category, items]) =>
      items.map(item => ({ ...item, categoryName: category }))
    );

    // Split items into two columns
    const midpoint = Math.ceil(allItems.length / 2);
    const leftColumn = allItems.slice(0, midpoint);
    const rightColumn = allItems.slice(midpoint);

    const renderItem = (item: any, index: number) => `
      <tr>
        <td class="item-name">${item.name}</td>
        <td class="unit-cell">${item.unit}</td>
        <td class="count-cell"></td>
      </tr>
    `;

    const renderColumn = (items: any[]) => {
      let currentCategory = '';
      let html = '';

      items.forEach((item, index) => {
        if (item.categoryName !== currentCategory) {
          currentCategory = item.categoryName;
          html += `<tr class="category-row"><td colspan="3">${currentCategory}</td></tr>`;
        }
        html += renderItem(item, index);
      });

      return html;
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
            font-size: 9px;
            line-height: 1.2;
            padding: 8px;
          }
          .header {
            text-align: center;
            margin-bottom: 8px;
            padding-bottom: 6px;
            border-bottom: 1px solid #333;
          }
          .header h1 { font-size: 16px; margin-bottom: 2px; }
          .header p { font-size: 10px; color: #000; margin: 1px 0; }
          .info-row {
            display: flex;
            gap: 20px;
            margin-bottom: 8px;
            padding: 6px;
            background: #f5f5f5;
            font-size: 9px;
          }
          .info-row .field { flex: 1; }
          .info-row label { font-weight: bold; display: block; margin-bottom: 2px; }
          .info-row .line { border-bottom: 1px solid #333; height: 16px; }

          .two-column-container {
            display: flex;
            gap: 10px;
          }
          .column {
            flex: 1;
            min-width: 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8px;
          }
          th, td {
            border: 1px solid #ccc;
            padding: 2px 4px;
            text-align: left;
          }
          th {
            background: #e0e0e0;
            font-weight: bold;
            font-size: 7px;
            text-transform: uppercase;
          }
          .category-row td {
            background: #333;
            color: white;
            font-weight: bold;
            font-size: 8px;
            padding: 3px 4px;
          }
          .item-name {
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .count-cell {
            width: 50px;
            min-width: 50px;
            background: #fffef0;
          }
          .unit-cell { width: 45px; min-width: 45px; font-size: 7px; }

          .footer {
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px solid #ccc;
            font-size: 8px;
            color: #000;
          }

          @media print {
            body { padding: 5px; }
            .no-print { display: none; }
            @page { margin: 0.3in; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Inventory Count Form</h1>
          <p><strong>${user?.property_name || 'Property'}</strong> | ${today}</p>
        </div>

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

        <div class="two-column-container">
          <div class="column">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="unit-cell">Unit</th>
                  <th class="count-cell">Count</th>
                </tr>
              </thead>
              <tbody>
                ${renderColumn(leftColumn)}
              </tbody>
            </table>
          </div>
          <div class="column">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="unit-cell">Unit</th>
                  <th class="count-cell">Count</th>
                </tr>
              </thead>
              <tbody>
                ${renderColumn(rightColumn)}
              </tbody>
            </table>
          </div>
        </div>

        <div class="footer">
          <p>Total: ${inventoryItems.length} items | ${Object.keys(groupedItems).length} categories</p>
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

  const isLoading = itemsLoading || countsLoading;

  return (
    <RoleGuard allowedRoles={['camp_worker']}>
      <DashboardLayout>
        <div className="space-y-4 md:space-y-6">
          {/* Mobile-optimized header */}
          <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">Inventory Count</h1>
              <p className="text-sm md:text-base text-gray-500 mt-1">
                Record current inventory levels for {user?.property_name || 'your property'}
              </p>
            </div>
            {/* Mobile: 2x2 grid of buttons, Desktop: horizontal row */}
            <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
              <Button variant="outline" onClick={handlePrintForm} className="text-sm md:text-base">
                <Printer className="h-4 w-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Print </span>Form
              </Button>
              <Button variant="outline" onClick={() => setShowPhotoModal(true)} className="text-sm md:text-base">
                <Camera className="h-4 w-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Scan </span>Photos
              </Button>
              <Button variant="outline" onClick={() => setShowHistoryModal(true)} className="text-sm md:text-base">
                <History className="h-4 w-4 mr-1 md:mr-2" />
                History
              </Button>
              <Button onClick={handleSubmit} isLoading={createCount.isPending} className="text-sm md:text-base">
                <Save className="h-4 w-4 mr-1 md:mr-2" />
                Save
              </Button>
            </div>
          </div>

          {/* Notes field */}
          <div className="bg-white rounded-xl shadow-sm p-3 md:p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Count Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this count..."
              className="w-full px-3 py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              rows={2}
            />
          </div>

          {isLoading ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <Calculator className="h-12 w-12 text-gray-300 mx-auto mb-4 animate-pulse" />
              <p className="text-gray-500">Loading inventory items...</p>
            </div>
          ) : inventoryItems.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <Calculator className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No inventory items found for your property</p>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-6">
              {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="px-4 md:px-6 py-3 md:py-4 bg-gray-50 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">{category}</h2>
                    <p className="text-sm text-gray-500">{items.length} items</p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="px-4 md:px-6 py-3 md:py-4 hover:bg-gray-50"
                      >
                        {/* Mobile: stacked layout, Desktop: horizontal layout */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
                          {/* Item info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{item.name}</p>
                            <div className="flex flex-wrap items-center gap-2 md:gap-4 mt-1 text-sm text-gray-500">
                              <span>Unit: {item.unit}</span>
                              {item.par_level && (
                                <span className="hidden sm:inline">Par: {item.par_level}</span>
                              )}
                              {item.supplier_name && (
                                <span className="hidden md:inline">Supplier: {item.supplier_name}</span>
                              )}
                            </div>
                          </div>

                          {/* Mobile: horizontal row for stock/count/diff, Desktop: same */}
                          <div className="flex items-center justify-between md:justify-end gap-3 md:gap-4">
                            {/* Current stock - compact on mobile */}
                            <div className="text-left md:text-right">
                              <p className="text-xs text-gray-500">Current</p>
                              <p className="font-medium text-sm md:text-base">{item.current_stock} {item.unit}</p>
                            </div>

                            {/* Count input - larger touch target on mobile */}
                            <div className="w-24 md:w-32">
                              <label className="text-xs text-gray-500 block">Count</label>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.5"
                                value={counts[item.id] ?? ''}
                                onChange={(e) => handleCountChange(item.id, e.target.value)}
                                className="w-full px-2 md:px-3 py-2 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-right"
                                placeholder="0"
                              />
                            </div>

                            {/* Difference indicator */}
                            <div className="w-12 md:w-16 text-right">
                              {counts[item.id] !== null && counts[item.id] !== item.current_stock && (
                                <span className={`text-sm font-medium ${
                                  (counts[item.id] ?? 0) > item.current_stock ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {(counts[item.id] ?? 0) > item.current_stock ? '+' : ''}
                                  {((counts[item.id] ?? 0) - item.current_stock).toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
                        {count.is_finalized && (
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
                    <li>Review the extracted counts and apply them to your form</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.heic,.heif"
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
              <p className="text-gray-600 font-medium">Click to upload photos</p>
              <p className="text-gray-400 text-sm mt-1">PNG, JPG, WEBP, HEIC supported. Multiple files allowed.</p>
            </div>

            {/* Photo previews */}
            {photoPreviewUrls.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Uploaded Photos ({photoPreviewUrls.length})</h4>
                  <button
                    onClick={clearAllPhotos}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {photoPreviewUrls.map((url, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={url}
                        alt={`Uploaded photo ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg border border-gray-200"
                      />
                      <button
                        onClick={() => removePhoto(index)}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <span className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                        Page {index + 1}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Analyze button */}
                <Button
                  onClick={analyzePhotos}
                  disabled={isAnalyzing || uploadedPhotos.length === 0}
                  className="w-full"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing with AI...
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4 mr-2" />
                      Analyze Photos ({uploadedPhotos.length})
                    </>
                  )}
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

                <div className="max-h-64 overflow-y-auto border rounded-lg divide-y divide-gray-200">
                  {extractedCounts.map((ec, index) => (
                    <div key={index} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{ec.item_name}</p>
                        {ec.notes && (
                          <p className="text-xs text-gray-500 mt-1">{ec.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-semibold text-lg">{ec.quantity}</span>
                        <div className={`px-2 py-0.5 rounded text-xs ${
                          ec.confidence >= 0.8 ? 'bg-green-100 text-green-700' :
                          ec.confidence >= 0.5 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {Math.round(ec.confidence * 100)}% confident
                        </div>
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
                <Button onClick={applyExtractedCounts} className="w-full">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Apply Counts to Form
                </Button>
              </div>
            )}
          </div>
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
