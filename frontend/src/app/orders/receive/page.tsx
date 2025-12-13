'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Package, CheckCircle, AlertTriangle, ChevronRight, ArrowLeft } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useMyOrders, useReceiveOrderItems, useOrder } from '@/hooks/useOrders';
import { formatCurrency } from '@/lib/utils';
import type { Order, OrderItem, ReceiveItemPayload } from '@/types';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  ordered: 'bg-purple-100 text-purple-800',
  partially_received: 'bg-indigo-100 text-indigo-800',
};

interface ReceivingItemState {
  item_id: number;
  received_quantity: number;
  has_issue: boolean;
  issue_description: string;
  receiving_notes: string;
}

export default function ReceiveOrdersPage() {
  const { data: allOrders = [], isLoading } = useMyOrders();
  const receiveItems = useReceiveOrderItems();

  // Filter to only ordered or partially_received orders
  const orders = allOrders.filter(
    o => o.status === 'ordered' || o.status === 'partially_received'
  );

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { data: selectedOrder } = useOrder(selectedOrderId || 0);

  const [receivingItems, setReceivingItems] = useState<Record<number, ReceivingItemState>>({});
  const [showFlagModal, setShowFlagModal] = useState<number | null>(null);

  const initializeReceivingItems = (order: Order) => {
    const items: Record<number, ReceivingItemState> = {};
    order.items?.forEach(item => {
      if (!item.is_received) {
        items[item.id] = {
          item_id: item.id,
          received_quantity: item.approved_quantity ?? item.requested_quantity,
          has_issue: false,
          issue_description: '',
          receiving_notes: '',
        };
      }
    });
    setReceivingItems(items);
  };

  const handleSelectOrder = (order: Order) => {
    setSelectedOrderId(order.id);
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
        [itemId]: { ...prev[itemId], has_issue: false, issue_description: '' }
      }));
    }
  };

  const handleSaveIssue = (itemId: number, description: string) => {
    setReceivingItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], has_issue: true, issue_description: description }
    }));
    setShowFlagModal(null);
  };

  const handleReceiveItems = async () => {
    if (!selectedOrderId) return;

    const itemsToReceive = Object.values(receivingItems).filter(
      item => item.received_quantity >= 0
    );

    if (itemsToReceive.length === 0) {
      toast.error('No items to receive');
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
          receiving_notes: item.receiving_notes || undefined,
        }))
      });

      const flaggedCount = itemsToReceive.filter(i => i.has_issue).length;
      if (flaggedCount > 0) {
        toast.success(`Items received! ${flaggedCount} item(s) flagged for review.`);
      } else {
        toast.success('Items received successfully!');
      }

      setSelectedOrderId(null);
      setReceivingItems({});
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : 'Failed to receive items';
      toast.error(message);
    }
  };

  const getItemName = (item: OrderItem) => item.item_name || item.custom_item_name || 'Unknown Item';
  const getFlaggedCount = () => Object.values(receivingItems).filter(i => i.has_issue).length;

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
                                {order.status === 'partially_received' ? 'Partially Received' : 'Ready to Receive'}
                              </span>
                            </div>
                            <div className="text-sm text-gray-500">
                              <span>Week of {new Date(order.week_of).toLocaleDateString()}</span>
                              <span className="mx-2">|</span>
                              <span>{receivedCount} of {totalCount} items received</span>
                              {order.estimated_total && (
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
                              <div className="text-sm text-gray-500 mt-1">
                                Expected: {item.approved_quantity ?? item.requested_quantity} {item.unit}
                                {item.unit_price && (
                                  <span className="ml-2">@ {formatCurrency(item.unit_price)}/{item.unit}</span>
                                )}
                              </div>
                              {isAlreadyReceived && item.received_quantity !== undefined && (
                                <div className="text-sm text-green-600 mt-1">
                                  Received: {item.received_quantity} {item.unit}
                                </div>
                              )}
                              {item.issue_description && (
                                <div className="mt-2 p-2 bg-amber-50 rounded text-sm text-amber-800">
                                  <strong>Issue:</strong> {item.issue_description}
                                </div>
                              )}
                            </div>

                            {!isAlreadyReceived && state && (
                              <div className="flex items-center gap-4">
                                <div className="flex flex-col items-end">
                                  <label className="text-xs text-gray-500 mb-1">Qty Received</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={state.received_quantity}
                                    onChange={(e) => handleQuantityChange(item.id, parseFloat(e.target.value) || 0)}
                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center"
                                  />
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
                                <div>
                                  <span className="text-sm font-medium text-amber-800">Issue Description:</span>
                                  <p className="text-sm text-amber-700 mt-1">{state.issue_description}</p>
                                </div>
                                <button
                                  onClick={() => setShowFlagModal(item.id)}
                                  className="text-xs text-amber-600 hover:text-amber-800"
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

                  <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
                    <Button
                      variant="outline"
                      onClick={() => { setSelectedOrderId(null); setReceivingItems({}); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleReceiveItems}
                      disabled={receiveItems.isPending || Object.keys(receivingItems).length === 0}
                    >
                      {receiveItems.isPending ? 'Saving...' : 'Confirm Receipt'}
                    </Button>
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
              onSave={(description) => handleSaveIssue(showFlagModal, description)}
              onCancel={() => setShowFlagModal(null)}
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
  onSave,
  onCancel,
}: {
  itemName: string;
  initialDescription: string;
  onSave: (description: string) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(initialDescription);

  const quickIssues = [
    'Item was wilted/spoiled',
    'Wrong item delivered',
    'Quantity was short',
    'Item was damaged',
    'Quality below standard',
    'Item was expired',
  ];

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

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(description)} disabled={!description.trim()}>
          Save Issue
        </Button>
      </div>
    </div>
  );
}
