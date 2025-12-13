'use client';

import { useState, useRef } from 'react';
import { Upload, X, Check, AlertTriangle, Loader2, Trash2, Edit2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import { useProperties } from '@/hooks/useProperties';
import api from '@/lib/api';
import toast from 'react-hot-toast';

const CATEGORIES = ['Dairy', 'Protein', 'Produce', 'Dry Goods', 'Canned/Jarred', 'Beverages', 'Condiments', 'Other'];
const UNITS = ['each', 'lb', 'oz', 'gallon', 'quart', 'pint', 'case', 'box', 'bag', 'dozen', 'bunch', 'head', 'jar', 'can', 'bottle', 'pack', 'roll', 'sheet', 'unit'];

interface ExtractedItem {
  name: string;
  unit: string;
  category: string;
  par_level: number | null;
}

interface ExtractResult {
  success: boolean;
  property_id: number;
  property_name: string;
  extracted_items: ExtractedItem[];
  skipped_duplicates: string[];
  total_extracted: number;
  total_skipped: number;
  images_processed: number;
}

export default function SeedInventoryPage() {
  const { data: properties = [], isLoading: propertiesLoading } = useProperties();
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [editingItems, setEditingItems] = useState<ExtractedItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    // Add to existing files
    const newFiles = [...files, ...selectedFiles];
    setFiles(newFiles);

    // Generate previews for new files
    selectedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviews(prev => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    setPreviews(previews.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (!selectedPropertyId || files.length === 0) {
      toast.error('Please select a camp and upload at least one image');
      return;
    }

    setIsAnalyzing(true);
    setExtractResult(null);

    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('images', file);
      });

      const response = await api.post<ExtractResult>(
        `/inventory/seed-from-photo?property_id=${selectedPropertyId}`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          timeout: 240000, // 4 minute timeout for AI processing large inventory sheets
        }
      );

      setExtractResult(response.data);
      setEditingItems([...response.data.extracted_items]);
      toast.success(`Found ${response.data.total_extracted} new items!`);
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Failed to analyze images';
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateItem = (index: number, field: keyof ExtractedItem, value: string | number | null) => {
    const updated = [...editingItems];
    updated[index] = { ...updated[index], [field]: value };
    setEditingItems(updated);
  };

  const removeItem = (index: number) => {
    setEditingItems(editingItems.filter((_, i) => i !== index));
  };

  const handleConfirm = async () => {
    if (!selectedPropertyId || editingItems.length === 0) {
      toast.error('No items to add');
      return;
    }

    setIsConfirming(true);

    try {
      const response = await api.post(
        `/inventory/seed-confirm?property_id=${selectedPropertyId}`,
        editingItems
      );

      toast.success(`Successfully added ${response.data.created_count} items to inventory!`);

      // Reset the form
      setFiles([]);
      setPreviews([]);
      setExtractResult(null);
      setEditingItems([]);
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Failed to add items';
      toast.error(message);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setPreviews([]);
    setExtractResult(null);
    setEditingItems([]);
  };

  const selectedProperty = properties.find(p => p.id === selectedPropertyId);

  return (
    <RoleGuard allowedRoles={['admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Seed Inventory</h1>
            <p className="text-gray-500 mt-1">Upload inventory sheet photos to automatically extract and add items to a camp's inventory</p>
          </div>

          {/* Step 1: Select Camp */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4">1. Select Camp</h2>
            <select
              value={selectedPropertyId || ''}
              onChange={(e) => {
                setSelectedPropertyId(e.target.value ? parseInt(e.target.value) : null);
                handleReset();
              }}
              className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              disabled={propertiesLoading || isAnalyzing}
            >
              <option value="">-- Select a camp --</option>
              {properties.map(property => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Upload Photos */}
          {selectedPropertyId && !extractResult && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4">2. Upload Inventory Sheet Photos</h2>
              <p className="text-sm text-gray-500 mb-4">
                Upload one or more photos of inventory sheets. The AI will extract item names and try to categorize them.
                Duplicate items (already in the inventory) will be automatically skipped.
              </p>

              {/* File input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Upload area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 hover:bg-gray-50 transition-colors"
              >
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">Click to upload or drag and drop</p>
                <p className="text-sm text-gray-500 mt-1">PNG, JPG, HEIC supported</p>
              </div>

              {/* Preview images */}
              {previews.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Uploaded Images ({previews.length})</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {previews.map((preview, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={preview}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                          className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Analyze button */}
              {files.length > 0 && (
                <div className="mt-6 flex justify-end">
                  <Button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="min-w-[200px]"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Analyze Photos
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Review and Confirm */}
          {extractResult && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-semibold">3. Review Extracted Items</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Found {editingItems.length} new items for {selectedProperty?.name}.
                    Edit or remove items before confirming.
                  </p>
                </div>
                <Button variant="outline" onClick={handleReset}>
                  Start Over
                </Button>
              </div>

              {/* Skipped duplicates notice */}
              {extractResult.skipped_duplicates.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2 mt-0.5" />
                    <div>
                      <p className="text-yellow-800 font-medium">
                        {extractResult.skipped_duplicates.length} duplicate items skipped
                      </p>
                      <p className="text-sm text-yellow-700 mt-1">
                        These items already exist in the inventory: {extractResult.skipped_duplicates.slice(0, 5).join(', ')}
                        {extractResult.skipped_duplicates.length > 5 && ` and ${extractResult.skipped_duplicates.length - 5} more`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Editable items table */}
              {editingItems.length > 0 ? (
                <>
                  <div className="border rounded-lg overflow-hidden mb-6">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">Unit</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">Category</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Par Level</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase w-16">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {editingItems.map((item, index) => (
                          <tr key={index}>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) => updateItem(index, 'name', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={item.unit}
                                onChange={(e) => updateItem(index, 'unit', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                              >
                                {UNITS.map(unit => (
                                  <option key={unit} value={unit}>{unit}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={item.category}
                                onChange={(e) => updateItem(index, 'category', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                              >
                                {CATEGORIES.map(cat => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={item.par_level || ''}
                                onChange={(e) => updateItem(index, 'par_level', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="-"
                                className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => removeItem(index)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={handleReset}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConfirm}
                      disabled={isConfirming || editingItems.length === 0}
                    >
                      {isConfirming ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Adding Items...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Add {editingItems.length} Items to Inventory
                        </>
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No new items to add. All items from the photo already exist in the inventory.
                </div>
              )}
            </div>
          )}
        </div>
      </DashboardLayout>
    </RoleGuard>
  );
}
