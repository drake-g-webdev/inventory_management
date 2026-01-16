'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Package, CheckCircle, AlertTriangle, ChevronRight, ArrowLeft, Camera, X, Image as ImageIcon, Plus, Search } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useMyOrders, useReceiveOrderItems, useOrder, useUploadIssuePhoto, useAddReceivingItem } from '@/hooks/useOrders';
import { useInventoryItems } from '@/hooks/useInventory';
import { formatCurrency } from '@/lib/utils';
import type { Order, OrderItem, ReceiveItemPayload, InventoryItem } from '@/types';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  ordered: 'bg-purple-100 text-purple-800',
  partially_received: 'bg-indigo-100 text-indigo-800',
  received: 'bg-green-100 text-green-800',
};

interface ReceivingItemState {
  item_id: number;
  received_quantity: number;
  has_issue: boolean;
  issue_description: string;
  issue_photo_url: string;
  receiving_notes: string;
}

export default function ReceiveOrdersPage() {
  const { data: allOrders = [], isLoading } = useMyOrders();
  const receiveItems = useReceiveOrderItems();
  const addReceivingItem = useAddReceivingItem();

  // Filter to orders that can be received or edited
  const orders = allOrders.filter(
    o => o.status === 'ordered' || o.status === 'partially_received' || o.status === 'received'
  );

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { data: selectedOrder, refetch: refetchOrder } = useOrder(selectedOrderId || 0);

  const [receivingItems, setReceivingItems] = useState<Record<number, ReceivingItemState>>({});
  const [showFlagModal, setShowFlagModal] = useState<number | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);

  const initializeReceivingItems = (order: Order) => {
    const items: Record<number, ReceivingItemState> = {};
    order.items?.forEach(item => {
      // Include all items - both received and not yet received
      const hasSavedProgress = item.received_quantity !== null && item.received_quantity !== undefined;
      items[item.id] = {
        item_id: item.id,
        received_quantity: hasSavedProgress ? (item.received_quantity as number) : 0,
        has_issue: item.has_issue || false,
        issue_description: item.issue_description || '',
        issue_photo_url: item.issue_photo_url || '',
        receiving_notes: item.receiving_notes || '',
      };
    });
    setReceivingItems(items);
  };

  // Reinitialize when server data loads (ensures we have the freshest saved progress)
  useEffect(() => {
    if (selectedOrder && selectedOrderId) {
      initializeReceivingItems(selectedOrder);
    }
  }, [selectedOrder?.id]);

  const handleSelectOrder = (order: Order) => {
    setSelectedOrderId(order.id);
    // Initialize with list data first; will reinitialize when useOrder fetches fresh data
    initializeReceivingItems(order);
  };

  const handleQuantityChange = (itemId: number, quantity: number) => {
    setReceivingItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], received_quantity: quantity }
    }));
  };

  const handleToggleIssue = (itemId: number) => {
    const current = receivingItems[itemId];
    if (!current.has_issue) {
      setShowFlagModal(itemId);
    } else {
      setReceivingItems(prev => ({
        ...prev,
        [itemId]: { ...prev[itemId], has_issue: false, issue_description: '', issue_photo_url: '' }
      }));
    }
  };

  const handleSaveIssue = (itemId: number, description: string, photoUrl: string) => {
    setReceivingItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], has_issue: true, issue_description: description, issue_photo_url: photoUrl }
    }));
    setShowFlagModal(null);
  };

  const handleReceiveItems = async (finalize: boolean) => {
    if (!selectedOrderId) return;

    const itemsToReceive = Object.values(receivingItems).filter(
      item => item.received_quantity >= 0
    );

    if (itemsToReceive.length === 0) {
      toast.error('No items to save');
      return;
    }

    try {
      await receiveItems.mutateAsync({
        id: selectedOrderId,
        items: itemsToReceive.map(item => ({
          item_id: item.item_id,
          received_quantity: item.received_quantity,
          has_issue: item.has_issue,
          issue_description: item.issue_description || undefined,
          issue_photo_url: item.issue_photo_url || undefined,
          receiving_notes: item.receiving_notes || undefined,
        })),
        finalize,
      });

      if (finalize) {
        const flaggedCount = itemsToReceive.filter(i => i.has_issue).length;
        if (flaggedCount > 0) {
          toast.success(`Items received! ${flaggedCount} item(s) flagged for review.`);
        } else {
          toast.success('Items received successfully!');
        }
        setSelectedOrderId(null);
        setReceivingItems({});
      } else {
        toast.success('Progress saved! You can continue receiving later.');
      }
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : 'Failed to save';
      toast.error(message);
    }
  };

  const getItemName = (item: OrderItem) => item.item_name || item.custom_item_name || 'Unknown Item';
  const getFlaggedCount = () => Object.values(receivingItems).filter(i => i.has_issue).length;

  const handleAddItem = async (inventoryItemId: number, quantity: number) => {
    if (!selectedOrderId) return;

    try {
      await addReceivingItem.mutateAsync({
        orderId: selectedOrderId,
        item: {
          inventory_item_id: inventoryItemId,
          requested_quantity: quantity,
        },
      });

      // Refetch the order to get the updated items list
      await refetchOrder();
      setShowAddItemModal(false);
      toast.success('Item added to order');
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : 'Failed to add item';
      toast.error(message);
    }
  };

  return (
    <RoleGuard allowedRoles={['camp_worker']}>
      <DashboardLayout>
        <div className="space-y-6">
          {!selectedOrderId ? (
            <>
              {/* Order List View */}
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Receive Orders</h1>
                  <p className="text-gray-500 mt-1">Mark items as received and flag any issues</p>
                </div>
                <Link href="/orders">
                  <Button variant="outline">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Orders
                  </Button>
                </Link>
              </div>

              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                {isLoading ? (
                  <div className="p-8 text-center">Loading...</div>
                ) : orders.length === 0 ? (
                  <div className="p-8 text-center">
                    <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 mb-2">No orders ready to receive</p>
                    <p className="text-sm text-gray-400">Orders will appear here once they have been placed with suppliers</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {orders.map((order) => {
                      const receivedCount = order.items?.filter(i => i.is_received).length || 0;
                      const totalCount = order.items?.length || 0;
                      // Count items with saved progress (received_quantity > 0 but not finalized)
                      const inProgressCount = order.items?.filter(
                        i => !i.is_received && i.received_quantity !== null && i.received_quantity !== undefined && i.received_quantity > 0
                      ).length || 0;
                      const hasSavedProgress = inProgressCount > 0;

                      return (
                        <div
                          key={order.id}
                          onClick={() => handleSelectOrder(order)}
                          className="p-6 hover:bg-gray-50 cursor-pointer flex items-center justify-between"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-semibold text-gray-900">
                                {order.order_number}
                              </span>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[order.status]}`}>
                                {order.status === 'received' ? 'Received' : order.status === 'partially_received' ? 'Partially Received' : 'Ready to Receive'}
                              </span>
                              {hasSavedProgress && (
                                <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                                  In Progress
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">
                              <span>Week of {new Date(order.week_of).toLocaleDateString()}</span>
                              <span className="mx-2">|</span>
                              <span>
                                {receivedCount} received
                                {inProgressCount > 0 && (
                                  <span className="text-blue-600">, {inProgressCount} in progress</span>
                                )}
                                {' '}of {totalCount} items
                              </span>
                              {!!order.estimated_total && (
                                <>
                                  <span className="mx-2">|</span>
                                  <span>{formatCurrency(order.estimated_total)}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-gray-400" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Receiving View */}
              <div className="flex justify-between items-center">
                <div>
                  <button
                    onClick={() => { setSelectedOrderId(null); setReceivingItems({}); }}
                    className="flex items-center text-gray-600 hover:text-gray-900 mb-2"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back to Orders
                  </button>
                  <h1 className="text-2xl font-bold text-gray-900">
                    Receive Order {selectedOrder?.order_number}
                  </h1>
                  <p className="text-gray-500 mt-1">
                    Mark items as received. Flag any items with quality issues.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowAddItemModal(true)}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Another Item
                </Button>
              </div>

              {selectedOrder && (
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="p-4 bg-gray-50 border-b">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">Week of:</span> {new Date(selectedOrder.week_of).toLocaleDateString()}
                      </div>
                      {getFlaggedCount() > 0 && (
                        <div className="flex items-center text-amber-600 text-sm">
                          <AlertTriangle className="h-4 w-4 mr-1" />
                          {getFlaggedCount()} item(s) flagged with issues
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-gray-200">
                    {selectedOrder.items?.map((item) => {
                      const state = receivingItems[item.id];
                      const isAlreadyReceived = item.is_received;

                      return (
                        <div key={item.id} className={`p-4 ${isAlreadyReceived ? 'bg-green-50' : ''}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {getItemName(item)}
                                </span>
                                {isAlreadyReceived && (
                                  <span className="flex items-center text-green-600 text-xs">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Received
                                  </span>
                                )}
                                {item.has_issue && (
                                  <span className="flex items-center text-amber-600 text-xs">
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Issue Reported
                                  </span>
                                )}
                              </div>
                              <div className="text-sm mt-1">
                                <span className="font-medium text-gray-700">
                                  Expected: {item.approved_quantity ?? item.requested_quantity} {item.unit}
                                </span>
                                {item.unit_price && (
                                  <span className="ml-2 text-gray-500">@ {formatCurrency(item.unit_price)}/{item.unit}</span>
                                )}
                              </div>
                              {item.issue_description && !state?.has_issue && (
                                <div className="mt-2 p-2 bg-amber-50 rounded text-sm text-amber-800">
                                  <strong>Issue:</strong> {item.issue_description}
                                </div>
                              )}
                            </div>

                            {state && (
                              <div className="flex items-center gap-4">
                                <div className="flex flex-col items-end">
                                  <label className="text-xs text-gray-500 mb-1">{isAlreadyReceived ? 'Edit Qty' : 'Qty Received'}</label>
                                  {(() => {
                                    const expected = item.approved_quantity ?? item.requested_quantity;
                                    const received = state.received_quantity;
                                    let inputClass = 'border-gray-300 bg-gray-50 text-gray-400'; // 0 received
                                    if (received > 0 && received < expected) {
                                      inputClass = 'border-amber-300 bg-amber-50 text-amber-700 font-medium'; // partial
                                    } else if (received >= expected) {
                                      inputClass = 'border-green-300 bg-green-50 text-green-700 font-medium'; // full
                                    }
                                    return (
                                      <input
                                        type="number"
                                        min="0"
                                        value={state.received_quantity}
                                        onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                                        className={`w-24 px-3 py-2 border rounded-lg text-center ${inputClass}`}
                                      />
                                    );
                                  })()}
                                </div>

                                <button
                                  onClick={() => handleToggleIssue(item.id)}
                                  className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium ${
                                    state.has_issue
                                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                      : 'bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-700'
                                  }`}
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                  {state.has_issue ? 'Flagged' : 'Flag Issue'}
                                </button>
                              </div>
                            )}
                          </div>

                          {state?.has_issue && state.issue_description && (
                            <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <span className="text-sm font-medium text-amber-800">Issue Description:</span>
                                  <p className="text-sm text-amber-700 mt-1">{state.issue_description}</p>
                                  {state.issue_photo_url && (
                                    <div className="mt-2">
                                      <img
                                        src={`${process.env.NEXT_PUBLIC_API_URL}${state.issue_photo_url}`}
                                        alt="Issue photo"
                                        className="max-w-[200px] max-h-[150px] rounded-lg border border-amber-300"
                                      />
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => setShowFlagModal(item.id)}
                                  className="text-xs text-amber-600 hover:text-amber-800 ml-2"
                                >
                                  Edit
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-4 bg-gray-50 border-t">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <p className="text-sm text-gray-500">
                        {selectedOrder?.status === 'received'
                          ? 'Edit quantities and save changes. Inventory will be adjusted automatically.'
                          : 'Save progress to continue receiving later, or finalize to update inventory.'}
                      </p>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={() => { setSelectedOrderId(null); setReceivingItems({}); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleReceiveItems(false)}
                          disabled={receiveItems.isPending || Object.keys(receivingItems).length === 0}
                        >
                          {receiveItems.isPending ? 'Saving...' : 'Save Progress'}
                        </Button>
                        <Button
                          onClick={() => handleReceiveItems(true)}
                          disabled={receiveItems.isPending || Object.keys(receivingItems).length === 0}
                        >
                          {receiveItems.isPending ? 'Saving...' : selectedOrder?.status === 'received' ? 'Save Changes' : 'Finalize Receiving'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Flag Issue Modal */}
        <Modal
          isOpen={showFlagModal !== null}
          onClose={() => setShowFlagModal(null)}
          title="Flag Item Issue"
        >
          {showFlagModal !== null && (
            <FlagIssueForm
              itemName={selectedOrder?.items?.find(i => i.id === showFlagModal)?.item_name || 'Item'}
              initialDescription={receivingItems[showFlagModal]?.issue_description || ''}
              initialPhotoUrl={receivingItems[showFlagModal]?.issue_photo_url || ''}
              onSave={(description, photoUrl) => handleSaveIssue(showFlagModal, description, photoUrl)}
              onCancel={() => setShowFlagModal(null)}
            />
          )}
        </Modal>

        {/* Add Late Item Modal */}
        <Modal
          isOpen={showAddItemModal}
          onClose={() => setShowAddItemModal(false)}
          title="Add Late Arrival Item"
        >
          {selectedOrder && (
            <AddLateItemForm
              propertyId={selectedOrder.property_id}
              existingItemIds={(selectedOrder.items || []).map(i => i.inventory_item_id).filter((id): id is number => id !== null)}
              onAdd={handleAddItem}
              onCancel={() => setShowAddItemModal(false)}
              isAdding={addReceivingItem.isPending}
            />
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}

function FlagIssueForm({
  itemName,
  initialDescription,
  initialPhotoUrl,
  onSave,
  onCancel,
}: {
  itemName: string;
  initialDescription: string;
  initialPhotoUrl: string;
  onSave: (description: string, photoUrl: string) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialPhotoUrl || null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadIssuePhoto = useUploadIssuePhoto();

  const quickIssues = [
    'Item was wilted/spoiled',
    'Wrong item delivered',
    'Quantity was short',
    'Item was damaged',
    'Quality below standard',
    'Item was expired',
  ];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPhotoPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload file
    setIsUploading(true);
    try {
      const result = await uploadIssuePhoto.mutateAsync(file);
      setPhotoUrl(result.url);
      toast.success('Photo uploaded');
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === 'string'
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? detail[0].msg
          : 'Failed to upload photo';
      toast.error(message);
      setPhotoPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    setPhotoUrl('');
    setPhotoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-600">
        Describe the issue with <strong>{itemName}</strong>:
      </p>

      <div className="flex flex-wrap gap-2">
        {quickIssues.map((issue) => (
          <button
            key={issue}
            type="button"
            onClick={() => setDescription(prev => prev ? `${prev}. ${issue}` : issue)}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700"
          >
            {issue}
          </button>
        ))}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the issue in detail (e.g., 'Cilantro was wilted and slimy when it arrived')"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg h-32"
      />

      {/* Photo Upload Section */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Add Photo (Optional)
        </label>

        {photoPreview ? (
          <div className="relative inline-block">
            <img
              src={photoPreview.startsWith('data:') ? photoPreview : `${process.env.NEXT_PUBLIC_API_URL}${photoPreview}`}
              alt="Issue photo"
              className="max-w-xs max-h-48 rounded-lg border border-gray-300"
            />
            <button
              onClick={handleRemovePhoto}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              onChange={handleFileChange}
              className="hidden"
              id="issue-photo-input"
            />
            <label
              htmlFor="issue-photo-input"
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                isUploading
                  ? 'border-gray-300 bg-gray-50 cursor-wait'
                  : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50'
              }`}
            >
              {isUploading ? (
                <>
                  <div className="animate-spin h-5 w-5 border-2 border-primary-600 border-t-transparent rounded-full" />
                  <span className="text-gray-600">Uploading...</span>
                </>
              ) : (
                <>
                  <Camera className="h-5 w-5 text-gray-500" />
                  <span className="text-gray-600">Take Photo or Choose File</span>
                </>
              )}
            </label>
          </div>
        )}
        <p className="text-xs text-gray-500">
          Supports JPG, PNG, WebP, and HEIC (iPhone photos). Max 5MB.
        </p>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => onSave(description, photoUrl)}
          disabled={!description.trim() || isUploading}
        >
          Save Issue
        </Button>
      </div>
    </div>
  );
}

function AddLateItemForm({
  propertyId,
  existingItemIds,
  onAdd,
  onCancel,
  isAdding,
}: {
  propertyId: number;
  existingItemIds: number[];
  onAdd: (inventoryItemId: number, quantity: number) => void;
  onCancel: () => void;
  isAdding: boolean;
}) {
  const { data: inventoryItems = [], isLoading } = useInventoryItems(propertyId);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState(1);

  // Filter items that are not already in the order and match the search
  const availableItems = useMemo(() => {
    return inventoryItems
      .filter(item => !existingItemIds.includes(item.id))
      .filter(item => {
        if (!searchTerm.trim()) return true;
        const search = searchTerm.toLowerCase();
        return (
          item.name.toLowerCase().includes(search) ||
          item.category?.toLowerCase().includes(search) ||
          item.subcategory?.toLowerCase().includes(search)
        );
      })
      .slice(0, 20); // Limit to 20 results
  }, [inventoryItems, existingItemIds, searchTerm]);

  const handleSubmit = () => {
    if (!selectedItem) return;
    onAdd(selectedItem.id, quantity);
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-600">
        Add items that arrived late from a previous order.
      </p>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search inventory items..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setSelectedItem(null);
          }}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Item List */}
      {!selectedItem ? (
        <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">Loading inventory...</div>
          ) : availableItems.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              {searchTerm ? 'No matching items found' : 'All items are already in this order'}
            </div>
          ) : (
            availableItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="w-full p-3 text-left hover:bg-gray-50 flex justify-between items-center"
              >
                <div>
                  <div className="font-medium text-gray-900">{item.name}</div>
                  <div className="text-sm text-gray-500">
                    {item.category}
                    {item.subcategory && ` > ${item.subcategory}`}
                    {item.unit && ` | ${item.unit}`}
                  </div>
                </div>
                <Plus className="h-5 w-5 text-gray-400" />
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="border border-primary-200 bg-primary-50 rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-gray-900">{selectedItem.name}</div>
              <div className="text-sm text-gray-500">
                {selectedItem.category}
                {selectedItem.subcategory && ` > ${selectedItem.subcategory}`}
              </div>
            </div>
            <button
              onClick={() => setSelectedItem(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">
              Quantity Received:
            </label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center"
            />
            <span className="text-gray-500">{selectedItem.unit}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!selectedItem || isAdding}
        >
          {isAdding ? 'Adding...' : 'Add Item'}
        </Button>
      </div>
    </div>
  );
}
