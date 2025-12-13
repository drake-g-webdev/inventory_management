'use client';

import { useState } from 'react';
import { Upload, Eye, CheckCircle2, AlertCircle, Trash2, Plus, Package } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useReceipts, useUploadReceipt, useVerifyReceipt, useDeleteReceipt, useDeleteReceiptLineItem, useFinancialDashboard, useReceiptProperties, useReceiptOrdersByProperty, useAddToInventory } from '@/hooks/useReceipts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { formatCurrency } from '@/lib/utils';
import type { Receipt, UnmatchedReceiptItem } from '@/types';
import toast from 'react-hot-toast';

export default function ReceiptsPage() {
  const { data: receipts = [], isLoading } = useReceipts();
  const { data: financialData } = useFinancialDashboard();
  const { data: properties = [] } = useReceiptProperties();
  const { data: suppliers = [] } = useSuppliers();
  const uploadReceipt = useUploadReceipt();
  const verifyReceipt = useVerifyReceipt();
  const deleteReceipt = useDeleteReceipt();
  const deleteLineItem = useDeleteReceiptLineItem();
  const addToInventory = useAddToInventory();

  const [showUpload, setShowUpload] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [uploadData, setUploadData] = useState({
    order_id: '',
    notes: '',
    file: null as File | null,
  });
  const [filter, setFilter] = useState<'all' | 'pending' | 'processed' | 'verified'>('all');

  // State for adding unmatched item to inventory
  const [showAddToInventory, setShowAddToInventory] = useState(false);
  const [itemToAdd, setItemToAdd] = useState<UnmatchedReceiptItem | null>(null);
  const [addItemForm, setAddItemForm] = useState({
    name: '',
    category: '',
    unit: 'unit',
    unit_price: '',
    supplier_id: '',
    par_level: '',
    is_recurring: true,
  });

  // Fetch orders when property is selected
  const { data: orders = [], isLoading: ordersLoading } = useReceiptOrdersByProperty(selectedPropertyId);

  const filteredReceipts = receipts.filter(receipt => {
    if (filter === 'pending') return !receipt.is_processed;
    if (filter === 'processed') return receipt.is_processed && !receipt.is_manually_verified;
    if (filter === 'verified') return receipt.is_manually_verified;
    return true;
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadData({ ...uploadData, file });
    }
  };

  const handleUpload = async () => {
    if (!uploadData.file) {
      toast.error('Please select a file');
      return;
    }
    if (!uploadData.order_id) {
      toast.error('Please select an order');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadData.file);
    formData.append('order_id', uploadData.order_id);
    if (uploadData.notes) {
      formData.append('notes', uploadData.notes);
    }

    try {
      await uploadReceipt.mutateAsync(formData);
      toast.success('Receipt uploaded and processed successfully');
      setShowUpload(false);
      setSelectedPropertyId(null);
      setUploadData({ order_id: '', notes: '', file: null });
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Upload failed');
    }
  };

  const handlePropertyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const propertyId = e.target.value ? parseInt(e.target.value) : null;
    setSelectedPropertyId(propertyId);
    setUploadData({ ...uploadData, order_id: '' }); // Reset order when property changes
  };

  const handleVerify = async (id: number) => {
    try {
      await verifyReceipt.mutateAsync(id);
      toast.success('Receipt verified');
      setViewingReceipt(null);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Verification failed');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this receipt?')) return;
    try {
      await deleteReceipt.mutateAsync(id);
      toast.success('Receipt deleted');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Delete failed');
    }
  };

  const handleDeleteLineItem = async (receiptId: number, itemIndex: number, itemName: string) => {
    if (!confirm(`Remove "${itemName}" from this receipt?`)) return;
    try {
      const updatedReceipt = await deleteLineItem.mutateAsync({ receiptId, itemIndex });
      toast.success('Line item removed');
      // Update the viewing receipt with new data
      setViewingReceipt(updatedReceipt);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to remove item');
    }
  };

  const openAddToInventory = (item: UnmatchedReceiptItem) => {
    setItemToAdd(item);
    setAddItemForm({
      name: item.suggested_name || item.item_name,
      category: item.suggested_category || '',
      unit: 'unit',
      unit_price: item.unit_price?.toString() || '',
      supplier_id: viewingReceipt?.supplier_id?.toString() || '',
      par_level: '',
      is_recurring: true,
    });
    setShowAddToInventory(true);
  };

  const handleAddToInventory = async () => {
    if (!viewingReceipt || !addItemForm.name) {
      toast.error('Please fill in required fields');
      return;
    }

    // Get property_id from the receipt's order
    const receipt = receipts.find(r => r.id === viewingReceipt.id);
    if (!receipt?.order_id) {
      toast.error('Could not determine property for this receipt');
      return;
    }

    // Find the order to get property_id
    const order = orders.find(o => o.id === receipt.order_id);
    const propertyId = order ? selectedPropertyId : null;

    // For now, we'll need to use a property ID - let's try to get it from context
    // Since the receipt is linked to an order, we should get property from the receipt data
    // Actually, we need to find a way to get the property_id

    try {
      await addToInventory.mutateAsync({
        name: addItemForm.name,
        property_id: viewingReceipt.property_id || selectedPropertyId || 1, // fallback - should have property on receipt
        supplier_id: addItemForm.supplier_id ? parseInt(addItemForm.supplier_id) : undefined,
        category: addItemForm.category || undefined,
        unit: addItemForm.unit,
        unit_price: addItemForm.unit_price ? parseFloat(addItemForm.unit_price) : undefined,
        par_level: addItemForm.par_level ? parseFloat(addItemForm.par_level) : undefined,
        is_recurring: addItemForm.is_recurring,
      });
      toast.success(`Added "${addItemForm.name}" to inventory`);
      setShowAddToInventory(false);
      setItemToAdd(null);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to add item to inventory');
    }
  };

  return (
    <RoleGuard allowedRoles={['purchasing_team', 'purchasing_supervisor']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
              <p className="text-gray-500 mt-1">Upload and manage purchase receipts</p>
            </div>
            <Button onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Receipt
            </Button>
          </div>

          {/* Financial Summary */}
          {financialData && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">This Month</p>
                <p className="text-2xl font-bold text-primary-600">{formatCurrency(financialData.total_spent_this_month)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">This Year</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(financialData.total_spent_this_year)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Pending Orders</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(financialData.pending_orders_total)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-sm text-gray-500">Pending Verification</p>
                <p className="text-2xl font-bold text-orange-600">
                  {financialData.receipts_pending_verification}
                </p>
              </div>
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex gap-2">
            {(['all', 'pending', 'processed', 'verified'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  filter === f
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'pending' && ` (${receipts.filter(r => !r.is_processed).length})`}
                {f === 'processed' && ` (${receipts.filter(r => r.is_processed && !r.is_manually_verified).length})`}
                {f === 'verified' && ` (${receipts.filter(r => r.is_manually_verified).length})`}
              </button>
            ))}
          </div>

          {/* Receipts list */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">Loading...</div>
            ) : filteredReceipts.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No receipts found</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Receipt #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredReceipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-medium text-gray-900">{receipt.supplier_name || 'Unknown'}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {receipt.receipt_date ? new Date(receipt.receipt_date).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {receipt.receipt_number || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {receipt.total ? formatCurrency(receipt.total) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {receipt.is_manually_verified ? (
                          <span className="flex items-center text-green-600">
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Verified
                          </span>
                        ) : receipt.is_processed ? (
                          <span className="flex items-center text-blue-600">
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Processed
                          </span>
                        ) : receipt.processing_error ? (
                          <span className="flex items-center text-red-600">
                            <AlertCircle className="h-4 w-4 mr-1" />
                            Error
                          </span>
                        ) : (
                          <span className="flex items-center text-yellow-600">
                            <AlertCircle className="h-4 w-4 mr-1" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onClick={() => setViewingReceipt(receipt)} className="text-primary-600 hover:text-primary-900 mr-3">
                          <Eye className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(receipt.id)} className="text-red-600 hover:text-red-900">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Upload Modal */}
        <Modal isOpen={showUpload} onClose={() => setShowUpload(false)} title="Upload Receipt">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property (Camp) *</label>
              <select
                value={selectedPropertyId || ''}
                onChange={handlePropertyChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Property</option>
                {properties.map(property => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Order *</label>
              <select
                value={uploadData.order_id}
                onChange={(e) => setUploadData({ ...uploadData, order_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                disabled={!selectedPropertyId || ordersLoading}
              >
                <option value="">{ordersLoading ? 'Loading orders...' : 'Select Order'}</option>
                {orders.map(order => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} - {order.item_count} items - {formatCurrency(order.estimated_total)}
                    {order.week_of && ` (${new Date(order.week_of).toLocaleDateString()})`}
                  </option>
                ))}
              </select>
              {selectedPropertyId && orders.length === 0 && !ordersLoading && (
                <p className="text-sm text-amber-600 mt-1">No orders found for this property (showing ordered/received orders only)</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Image *</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                onChange={handleFileChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-500 mt-1">Supports JPG, PNG, WebP, and HEIC (iPhone photos)</p>
              {uploadData.file && (
                <p className="text-sm text-gray-500 mt-1">Selected: {uploadData.file.name}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
              <textarea
                value={uploadData.notes}
                onChange={(e) => setUploadData({ ...uploadData, notes: e.target.value })}
                rows={2}
                placeholder="Any notes about this receipt..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                AI will extract line items from the receipt and attempt to match them with items from the selected order.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => {
                setShowUpload(false);
                setSelectedPropertyId(null);
                setUploadData({ order_id: '', notes: '', file: null });
              }}>Cancel</Button>
              <Button
                onClick={handleUpload}
                isLoading={uploadReceipt.isPending}
                disabled={!uploadData.file || !uploadData.order_id}
              >
                {uploadReceipt.isPending ? 'Processing...' : 'Upload & Process'}
              </Button>
            </div>
          </div>
        </Modal>

        {/* View Receipt Modal */}
        <Modal isOpen={!!viewingReceipt} onClose={() => setViewingReceipt(null)} title="Receipt Details" size="lg">
          {viewingReceipt && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Order</p>
                  <p className="font-medium">{viewingReceipt.order_number || 'Not linked'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Supplier</p>
                  <p className="font-medium">{viewingReceipt.supplier_name || 'Unknown'}</p>
                  {viewingReceipt.detected_supplier_name && viewingReceipt.detected_supplier_name !== viewingReceipt.supplier_name && (
                    <p className="text-xs text-blue-600 mt-1">Detected from receipt: {viewingReceipt.detected_supplier_name}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Receipt Date</p>
                  <p className="font-medium">{viewingReceipt.receipt_date ? new Date(viewingReceipt.receipt_date).toLocaleDateString() : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Receipt Number</p>
                  <p className="font-medium">{viewingReceipt.receipt_number || '-'}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded-lg p-4">
                <div>
                  <p className="text-sm text-gray-500">Subtotal</p>
                  <p className="font-medium">{viewingReceipt.subtotal ? formatCurrency(viewingReceipt.subtotal) : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Tax</p>
                  <p className="font-medium">{viewingReceipt.tax ? formatCurrency(viewingReceipt.tax) : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="font-medium text-lg text-primary-600">{viewingReceipt.total ? formatCurrency(viewingReceipt.total) : '-'}</p>
                </div>
              </div>

              {viewingReceipt.confidence_score && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">AI Confidence:</span>
                  <span className={`text-sm font-medium ${viewingReceipt.confidence_score >= 0.8 ? 'text-green-600' : viewingReceipt.confidence_score >= 0.6 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {(viewingReceipt.confidence_score * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              {viewingReceipt.line_items && viewingReceipt.line_items.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Extracted Line Items</p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Receipt Item</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Matched Order Item</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16">Delete</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {viewingReceipt.line_items.map((item: any, index: number) => (
                          <tr key={index}>
                            <td className="px-4 py-2 text-sm">{item.item_name || item.name}</td>
                            <td className="px-4 py-2 text-sm">{item.quantity || '-'}</td>
                            <td className="px-4 py-2 text-sm">{item.unit_price ? formatCurrency(item.unit_price) : '-'}</td>
                            <td className="px-4 py-2 text-sm">{item.total_price || item.total ? formatCurrency(item.total_price || item.total) : '-'}</td>
                            <td className="px-4 py-2 text-sm">
                              {item.matched_order_item_id ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Matched (ID: {item.matched_order_item_id})
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Not matched
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => handleDeleteLineItem(viewingReceipt.id, index, item.item_name || item.name)}
                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                                title="Remove this item"
                                disabled={deleteLineItem.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Unmatched Items Section */}
              {viewingReceipt.unmatched_items && viewingReceipt.unmatched_items.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="h-5 w-5 text-amber-600" />
                    <p className="text-sm font-medium text-amber-800">
                      Unmatched Items ({viewingReceipt.unmatched_items.length})
                    </p>
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    These items appear on the receipt but weren't matched to your order. They may be backorders or new items you'd like to add to inventory.
                  </p>
                  <div className="space-y-2">
                    {viewingReceipt.unmatched_items.map((item: UnmatchedReceiptItem, index: number) => (
                      <div key={index} className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
                        <div>
                          <p className="font-medium text-gray-900">{item.item_name}</p>
                          {item.suggested_name && item.suggested_name !== item.item_name && (
                            <p className="text-xs text-gray-500">Suggested: {item.suggested_name}</p>
                          )}
                          <div className="flex gap-3 text-xs text-gray-500 mt-1">
                            {item.quantity && <span>Qty: {item.quantity}</span>}
                            {item.unit_price && <span>Price: {formatCurrency(item.unit_price)}</span>}
                            {item.suggested_category && <span>Category: {item.suggested_category}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => openAddToInventory(item)}
                          className="bg-amber-600 hover:bg-amber-700"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add to Inventory
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewingReceipt.notes && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Notes</p>
                  <p className="text-sm text-gray-600">{viewingReceipt.notes}</p>
                </div>
              )}

              {viewingReceipt.processing_error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-red-800">Processing Error:</p>
                  <p className="text-sm text-red-700">{viewingReceipt.processing_error}</p>
                </div>
              )}

              {viewingReceipt.image_url && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Receipt Image</p>
                  <img src={`${process.env.NEXT_PUBLIC_API_URL}${viewingReceipt.image_url}`} alt="Receipt" className="max-w-full rounded-lg border" />
                </div>
              )}

              {viewingReceipt.is_processed && !viewingReceipt.is_manually_verified && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => handleVerify(viewingReceipt.id)}
                    isLoading={verifyReceipt.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Verify Receipt
                  </Button>
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* Add to Inventory Modal */}
        <Modal isOpen={showAddToInventory} onClose={() => setShowAddToInventory(false)} title="Add Item to Inventory">
          <div className="space-y-4">
            {itemToAdd && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-500">Adding from receipt:</p>
                <p className="font-medium">{itemToAdd.item_name}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
              <input
                type="text"
                value={addItemForm.name}
                onChange={(e) => setAddItemForm({ ...addItemForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="Sockeye Salmon"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  type="text"
                  value={addItemForm.category}
                  onChange={(e) => setAddItemForm({ ...addItemForm, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Protein"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select
                  value={addItemForm.unit}
                  onChange={(e) => setAddItemForm({ ...addItemForm, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="unit">Unit</option>
                  <option value="case">Case</option>
                  <option value="lb">lb</option>
                  <option value="oz">oz</option>
                  <option value="gallon">Gallon</option>
                  <option value="box">Box</option>
                  <option value="bag">Bag</option>
                  <option value="bottle">Bottle</option>
                  <option value="can">Can</option>
                  <option value="pack">Pack</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={addItemForm.unit_price}
                  onChange={(e) => setAddItemForm({ ...addItemForm, unit_price: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Par Level</label>
                <input
                  type="number"
                  step="0.1"
                  value={addItemForm.par_level}
                  onChange={(e) => setAddItemForm({ ...addItemForm, par_level: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Minimum stock level"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select
                value={addItemForm.supplier_id}
                onChange={(e) => setAddItemForm({ ...addItemForm, supplier_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Supplier (Optional)</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_recurring"
                checked={addItemForm.is_recurring}
                onChange={(e) => setAddItemForm({ ...addItemForm, is_recurring: e.target.checked })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="is_recurring" className="text-sm text-gray-700">
                Include on recurring inventory sheets
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowAddToInventory(false)}>Cancel</Button>
              <Button
                onClick={handleAddToInventory}
                isLoading={addToInventory.isPending}
                disabled={!addItemForm.name}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add to Inventory
              </Button>
            </div>
          </div>
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
