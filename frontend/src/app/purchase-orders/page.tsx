'use client';

import { useState } from 'react';
import { Plus, Eye, Trash2, Send, Check, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import {
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useDeletePurchaseOrder,
  useSubmitPurchaseOrder,
  useApprovePurchaseOrder,
  useReceivePurchaseOrder,
} from '@/hooks/usePurchaseOrders';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useItems } from '@/hooks/useItems';
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils';
import type { PurchaseOrder, CreatePurchaseOrderPayload } from '@/types';

export default function PurchaseOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);

  const { data: orders = [], isLoading } = usePurchaseOrders({
    status: statusFilter || undefined,
  });
  const { data: suppliers = [] } = useSuppliers();
  const { data: items = [] } = useItems();

  const createOrder = useCreatePurchaseOrder();
  const deleteOrder = useDeletePurchaseOrder();
  const submitOrder = useSubmitPurchaseOrder();
  const approveOrder = useApprovePurchaseOrder();
  const receiveOrder = useReceivePurchaseOrder();

  const [formData, setFormData] = useState<{
    supplier_id: number | null;
    notes: string;
    items: { item_id: number; quantity: number; unit_price: number }[];
  }>({
    supplier_id: null,
    notes: '',
    items: [],
  });

  const addOrderItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { item_id: 0, quantity: 1, unit_price: 0 }],
    });
  };

  const removeOrderItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const updateOrderItem = (index: number, field: string, value: number) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-fill price when item is selected
    if (field === 'item_id') {
      const selectedItem = items.find((i) => i.id === value);
      if (selectedItem?.price) {
        newItems[index].unit_price = selectedItem.price;
      }
    }

    setFormData({ ...formData, items: newItems });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.supplier_id) {
      toast.error('Please select a supplier');
      return;
    }
    if (formData.items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    try {
      await createOrder.mutateAsync({
        supplier_id: formData.supplier_id,
        notes: formData.notes || undefined,
        items: formData.items.filter((item) => item.item_id > 0),
      });
      toast.success('Purchase order created');
      setIsCreateModalOpen(false);
      setFormData({ supplier_id: null, notes: '', items: [] });
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to create order');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this order?')) return;
    try {
      await deleteOrder.mutateAsync(id);
      toast.success('Order deleted');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to delete order');
    }
  };

  const handleSubmit = async (id: number) => {
    try {
      await submitOrder.mutateAsync(id);
      toast.success('Order submitted for approval');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to submit order');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await approveOrder.mutateAsync(id);
      toast.success('Order approved');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to approve order');
    }
  };

  const handleReceive = async (id: number) => {
    try {
      await receiveOrder.mutateAsync(id);
      toast.success('Order marked as received');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to receive order');
    }
  };

  const viewOrder = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setIsViewModalOpen(true);
  };

  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'ordered', label: 'Ordered' },
    { value: 'received', label: 'Received' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
            <p className="text-gray-500 mt-1">Create and manage purchase orders</p>
          </div>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </div>

        {/* Filter */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-4">
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-48"
            />
            {statusFilter && (
              <Button variant="ghost" onClick={() => setStatusFilter('')}>
                Clear Filter
              </Button>
            )}
          </div>
        </div>

        {/* Orders Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium text-gray-900">{order.order_number}</TableCell>
                    <TableCell className="text-gray-500">{order.supplier_name}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-900">{formatCurrency(order.total_amount)}</TableCell>
                    <TableCell className="text-gray-500">{formatDate(order.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <button onClick={() => viewOrder(order)} className="text-gray-400 hover:text-primary-600">
                          <Eye className="h-4 w-4" />
                        </button>
                        {order.status === 'draft' && (
                          <>
                            <button onClick={() => handleSubmit(order.id)} className="text-gray-400 hover:text-blue-600">
                              <Send className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDelete(order.id)} className="text-gray-400 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {order.status === 'pending' && (
                          <button onClick={() => handleApprove(order.id)} className="text-gray-400 hover:text-green-600">
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        {(order.status === 'approved' || order.status === 'ordered') && (
                          <button onClick={() => handleReceive(order.id)} className="text-gray-400 hover:text-green-600">
                            <Package className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Create Order Modal */}
        <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Create Purchase Order" size="xl">
          <form onSubmit={handleCreateOrder} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Supplier"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={formData.supplier_id || ''}
                onChange={(e) => setFormData({ ...formData, supplier_id: Number(e.target.value) })}
                required
              />
              <Input
                label="Notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>

            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-medium">Order Items</h4>
                <Button type="button" variant="secondary" size="sm" onClick={addOrderItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>

              {formData.items.map((item, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 mb-2">
                  <Select
                    options={items.map((i) => ({ value: i.id, label: `${i.name} ${i.brand ? `(${i.brand})` : ''}` }))}
                    value={item.item_id || ''}
                    onChange={(e) => updateOrderItem(index, 'item_id', Number(e.target.value))}
                  />
                  <Input
                    type="number"
                    placeholder="Quantity"
                    value={item.quantity}
                    onChange={(e) => updateOrderItem(index, 'quantity', Number(e.target.value))}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Unit Price"
                    value={item.unit_price}
                    onChange={(e) => updateOrderItem(index, 'unit_price', Number(e.target.value))}
                  />
                  <Button type="button" variant="danger" size="sm" onClick={() => removeOrderItem(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {formData.items.length > 0 && (
                <div className="text-right mt-4 text-lg font-semibold">
                  Total: {formatCurrency(formData.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0))}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Button type="button" variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={createOrder.isPending}>
                Create Order
              </Button>
            </div>
          </form>
        </Modal>

        {/* View Order Modal */}
        <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title={`Order ${selectedOrder?.order_number}`} size="lg">
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Supplier</p>
                  <p className="font-medium">{selectedOrder.supplier_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(selectedOrder.status)}`}>
                    {selectedOrder.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Created</p>
                  <p className="font-medium">{formatDate(selectedOrder.created_at)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="font-medium text-lg">{formatCurrency(selectedOrder.total_amount)}</p>
                </div>
              </div>

              {selectedOrder.notes && (
                <div>
                  <p className="text-sm text-gray-500">Notes</p>
                  <p>{selectedOrder.notes}</p>
                </div>
              )}

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Items</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.item_name}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                        <TableCell>{formatCurrency(item.total_price)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </DashboardLayout>
  );
}
