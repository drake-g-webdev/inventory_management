'use client';

import { useState, useCallback } from 'react';
import { Upload, FileText, Calendar, Building2, Loader2, CheckCircle2, Trash2, Edit2, Plus } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import { useProperties } from '@/hooks/useProperties';
import { useSuppliers } from '@/hooks/useSuppliers';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface ExtractedItem {
  item_name: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  supplier_name: string | null;
  category: string | null;
  notes: string | null;
  is_recurring: boolean;
}

const PRODUCT_CATEGORIES = [
  'Produce',
  'Dairy',
  'Protein',
  'Dry Goods',
  'Beverages',
  'Frozen',
  'Bakery',
  'Condiments',
  'Spices',
  'Packaged Goods',
  'Paper Goods',
  'Cleaning Supplies',
  'Other',
];

const UNITS_OF_MEASURE = [
  'Unit',
  'Case',
  'Box',
  'Pack',
  'Bag',
  'lb',
  'oz',
  'kg',
  'Gallon',
  'Quart',
  'Pint',
  'Liter',
  'Dozen',
  'Bundle',
  'Roll',
  'Jar',
  'Can',
  'Bottle',
];

interface ExtractedOrderData {
  items: ExtractedItem[];
  order_date: string | null;
  order_number: string | null;
  total: number | null;
  supplier_name: string | null;
  notes: string | null;
  confidence_score: number;
}

type Step = 'upload' | 'review' | 'success';

export default function SeedOrdersPage() {
  const { data: properties = [], isLoading: propertiesLoading } = useProperties();
  const { data: suppliers = [] } = useSuppliers();

  // Form state
  const [step, setStep] = useState<Step>('upload');
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | ''>('');
  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Processing state
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedOrderData | null>(null);
  const [editedItems, setEditedItems] = useState<ExtractedItem[]>([]);

  // Edit item modal
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ExtractedItem | null>(null);
  const [useCustomSupplier, setUseCustomSupplier] = useState(false);
  const [customSupplierName, setCustomSupplierName] = useState('');

  // Created order
  const [createdOrderNumber, setCreatedOrderNumber] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const filename = file.name.toLowerCase();
      if (!filename.endsWith('.pdf') && !filename.endsWith('.docx')) {
        toast.error('Please select a PDF or DOCX file');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleExtract = async () => {
    if (!selectedFile || !selectedPropertyId) {
      toast.error('Please select a property and upload a file');
      return;
    }

    setIsExtracting(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await api.post<ExtractedOrderData>('/admin/extract-order-pdf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setExtractedData(response.data);
      // Ensure all items have is_recurring set (default to true)
      setEditedItems(response.data.items.map(item => ({
        ...item,
        is_recurring: item.is_recurring ?? true
      })));

      // Use extracted date if available
      if (response.data.order_date) {
        setOrderDate(response.data.order_date);
      }

      setStep('review');
      toast.success(`Extracted ${response.data.items.length} items from document`);
    } catch (error: any) {
      console.error('Extraction error:', error);
      toast.error(error.response?.data?.detail || 'Failed to extract order data from document');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleEditItem = (index: number) => {
    setEditingIndex(index);
    const item = editedItems[index];
    setEditForm({ ...item });
    // Check if supplier_name matches an existing supplier
    const matchingSupplier = suppliers.find(s => s.name === item.supplier_name);
    if (item.supplier_name && !matchingSupplier) {
      setUseCustomSupplier(true);
      setCustomSupplierName(item.supplier_name);
    } else {
      setUseCustomSupplier(false);
      setCustomSupplierName('');
    }
  };

  const handleSaveItemEdit = () => {
    if (editingIndex !== null && editForm) {
      const updated = [...editedItems];
      updated[editingIndex] = editForm;
      setEditedItems(updated);
      setEditingIndex(null);
      setEditForm(null);
    }
  };

  const handleDeleteItem = (index: number) => {
    setEditedItems(editedItems.filter((_, i) => i !== index));
  };

  const handleAddItem = () => {
    setEditingIndex(-1); // -1 indicates new item
    setEditForm({
      item_name: '',
      quantity: 1,
      unit: 'Unit',
      unit_price: null,
      supplier_name: null,
      category: null,
      notes: null,
      is_recurring: true,
    });
    setUseCustomSupplier(false);
    setCustomSupplierName('');
  };

  const handleSaveNewItem = () => {
    if (editForm && editForm.item_name) {
      setEditedItems([...editedItems, editForm]);
      setEditingIndex(null);
      setEditForm(null);
    }
  };

  const handleCreateOrder = async () => {
    if (!selectedPropertyId || editedItems.length === 0) {
      toast.error('Please select a property and have at least one item');
      return;
    }

    setIsCreating(true);
    try {
      const response = await api.post('/admin/seed-historical-order', {
        property_id: selectedPropertyId,
        order_date: orderDate,
        items: editedItems,
        status: 'received',
        notes: extractedData?.notes || `Seeded from document upload`,
      });

      setCreatedOrderNumber(response.data.order_number);
      setStep('success');
      toast.success('Historical order created successfully!');
    } catch (error: any) {
      console.error('Create order error:', error);
      toast.error(error.response?.data?.detail || 'Failed to create order');
    } finally {
      setIsCreating(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setSelectedFile(null);
    setExtractedData(null);
    setEditedItems([]);
    setCreatedOrderNumber(null);
  };

  const calculateTotal = () => {
    return editedItems.reduce((sum, item) => {
      return sum + (item.quantity * (item.unit_price || 0));
    }, 0);
  };

  return (
    <RoleGuard allowedRoles={['admin']}>
      <DashboardLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Seed Historical Orders</h1>
            <p className="text-gray-500 mt-1">Upload past order documents (PDF or DOCX) to extract and seed historical data</p>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-center space-x-4">
            {['upload', 'review', 'success'].map((s, index) => (
              <div key={s} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s ? 'bg-primary-600 text-white' :
                  ['upload', 'review', 'success'].indexOf(step) > index ? 'bg-green-600 text-white' :
                  'bg-gray-200 text-gray-500'
                }`}>
                  {['upload', 'review', 'success'].indexOf(step) > index ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={`ml-2 text-sm ${step === s ? 'text-primary-600 font-medium' : 'text-gray-500'}`}>
                  {s === 'upload' ? 'Upload Document' : s === 'review' ? 'Review & Edit' : 'Complete'}
                </span>
                {index < 2 && <div className="w-12 h-0.5 bg-gray-200 mx-4" />}
              </div>
            ))}
          </div>

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
              {/* Property Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building2 className="h-4 w-4 inline mr-1" />
                  Select Property
                </label>
                <Select
                  id="property"
                  value={selectedPropertyId.toString()}
                  onChange={(e) => setSelectedPropertyId(e.target.value ? parseInt(e.target.value) : '')}
                  options={[
                    { value: '', label: 'Select a property...' },
                    ...properties.map(p => ({ value: p.id.toString(), label: p.name }))
                  ]}
                />
              </div>

              {/* Date Picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Order Date
                </label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <FileText className="h-4 w-4 inline mr-1" />
                  Upload Order Document
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-400 transition-colors">
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="document-upload"
                  />
                  <label htmlFor="document-upload" className="cursor-pointer">
                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText className="h-8 w-8 text-primary-600" />
                        <div>
                          <p className="font-medium text-gray-900">{selectedFile.name}</p>
                          <p className="text-sm text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                        <p className="text-gray-600">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-400 mt-1">PDF or DOCX files (max 10MB)</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {/* Extract Button */}
              <div className="flex justify-end">
                <Button
                  onClick={handleExtract}
                  disabled={!selectedFile || !selectedPropertyId || isExtracting}
                  isLoading={isExtracting}
                >
                  {isExtracting ? 'Extracting with AI...' : 'Extract Order Data'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Review & Edit */}
          {step === 'review' && extractedData && (
            <div className="space-y-6">
              {/* Confidence Score */}
              <div className={`p-4 rounded-lg ${
                extractedData.confidence_score >= 0.8 ? 'bg-green-50 border border-green-200' :
                extractedData.confidence_score >= 0.5 ? 'bg-yellow-50 border border-yellow-200' :
                'bg-red-50 border border-red-200'
              }`}>
                <p className="text-sm">
                  <strong>AI Confidence:</strong> {(extractedData.confidence_score * 100).toFixed(0)}%
                  {extractedData.confidence_score < 0.8 && (
                    <span className="ml-2 text-gray-600">- Please review the extracted items carefully</span>
                  )}
                </p>
              </div>

              {/* Order Details */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Property</label>
                    <p className="font-medium">{properties.find(p => p.id === selectedPropertyId)?.name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Order Date</label>
                    <input
                      type="date"
                      value={orderDate}
                      onChange={(e) => setOrderDate(e.target.value)}
                      className="px-3 py-1 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>

                {/* Items Table */}
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Extracted Items ({editedItems.length})</h3>
                  <Button size="sm" variant="outline" onClick={handleAddItem}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </div>

                <div className="border rounded-lg overflow-hidden overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                        <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Recurring</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {editedItems.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-3 py-3">
                            <span className="font-medium">{item.item_name}</span>
                            {item.notes && <p className="text-xs text-gray-500 mt-0.5">{item.notes}</p>}
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700">
                              {item.category || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">{item.quantity}</td>
                          <td className="px-3 py-3">{item.unit || '-'}</td>
                          <td className="px-3 py-3 text-sm text-gray-500">{item.supplier_name || '-'}</td>
                          <td className="px-3 py-3 text-center">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.is_recurring ?? true}
                                onChange={(e) => {
                                  const updated = [...editedItems];
                                  updated[index] = { ...item, is_recurring: e.target.checked };
                                  setEditedItems(updated);
                                }}
                                className="sr-only peer"
                              />
                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                            </label>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button onClick={() => handleEditItem(index)} className="text-primary-600 hover:text-primary-900 mr-2">
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDeleteItem(index)} className="text-red-600 hover:text-red-900">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('upload')}>
                  Back to Upload
                </Button>
                <Button
                  onClick={handleCreateOrder}
                  disabled={editedItems.length === 0 || isCreating}
                  isLoading={isCreating}
                >
                  Create Historical Order
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 'success' && (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Created Successfully!</h2>
              <p className="text-gray-600 mb-4">
                Order <strong>{createdOrderNumber}</strong> has been created and added to the order history.
              </p>
              <div className="flex justify-center gap-4">
                <Button variant="outline" onClick={handleReset}>
                  Seed Another Order
                </Button>
                <Button onClick={() => window.location.href = '/orders/all'}>
                  View All Orders
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Edit Item Modal */}
        <Modal
          isOpen={editingIndex !== null}
          onClose={() => { setEditingIndex(null); setEditForm(null); }}
          title={editingIndex === -1 ? 'Add Item' : 'Edit Item'}
        >
          {editForm && (
            <div className="space-y-4">
              <Input
                id="item_name"
                label="Item Name"
                value={editForm.item_name}
                onChange={(e) => setEditForm({ ...editForm, item_name: e.target.value })}
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="quantity"
                  label="Quantity"
                  type="number"
                  min="0"
                  step="0.5"
                  value={editForm.quantity.toString()}
                  onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) || 0 })}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <Select
                    id="unit_select"
                    value={editForm.unit || 'Unit'}
                    onChange={(e) => setEditForm({ ...editForm, unit: e.target.value || null })}
                    options={UNITS_OF_MEASURE.map(unit => ({ value: unit, label: unit }))}
                  />
                </div>
              </div>
              <Input
                id="unit_price"
                label="Unit Price"
                type="number"
                min="0"
                step="0.01"
                value={editForm.unit_price?.toString() || ''}
                onChange={(e) => setEditForm({ ...editForm, unit_price: parseFloat(e.target.value) || null })}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <Select
                  id="supplier_select"
                  value={useCustomSupplier ? '__custom__' : (editForm.supplier_name || '')}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '__custom__') {
                      setUseCustomSupplier(true);
                      setEditForm({ ...editForm, supplier_name: customSupplierName || null });
                    } else {
                      setUseCustomSupplier(false);
                      setCustomSupplierName('');
                      setEditForm({ ...editForm, supplier_name: value || null });
                    }
                  }}
                  options={[
                    { value: '', label: 'No supplier' },
                    ...suppliers.map(s => ({ value: s.name, label: s.name })),
                    { value: '__custom__', label: '+ Enter custom supplier...' },
                  ]}
                />
                {useCustomSupplier && (
                  <Input
                    id="custom_supplier"
                    placeholder="Enter custom supplier name"
                    value={customSupplierName}
                    onChange={(e) => {
                      setCustomSupplierName(e.target.value);
                      setEditForm({ ...editForm, supplier_name: e.target.value || null });
                    }}
                    className="mt-2"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <Select
                  id="category_select"
                  value={editForm.category || ''}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value || null })}
                  options={[
                    { value: '', label: 'No category' },
                    ...PRODUCT_CATEGORIES.map(cat => ({ value: cat, label: cat })),
                  ]}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editForm.notes || ''}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value || null })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.is_recurring ?? true}
                    onChange={(e) => setEditForm({ ...editForm, is_recurring: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-gray-700">Recurring Item</span>
                  <p className="text-xs text-gray-500">Recurring items appear on the printed inventory count form</p>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => { setEditingIndex(null); setEditForm(null); }}>
                  Cancel
                </Button>
                <Button onClick={editingIndex === -1 ? handleSaveNewItem : handleSaveItemEdit}>
                  {editingIndex === -1 ? 'Add Item' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
