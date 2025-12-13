'use client';

import { useState } from 'react';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useItems, useCreateItem, useUpdateItem, useDeleteItem } from '@/hooks/useItems';
import { useCategories } from '@/hooks/useCategories';
import { useSuppliers } from '@/hooks/useSuppliers';
import { formatCurrency } from '@/lib/utils';
import type { Item, CreateItemPayload } from '@/types';

export default function ItemsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>();
  const [supplierFilter, setSupplierFilter] = useState<number | undefined>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  const { data: items = [], isLoading } = useItems({
    search: search || undefined,
    category_id: categoryFilter,
    supplier_id: supplierFilter,
  });
  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();

  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();

  const [formData, setFormData] = useState<CreateItemPayload>({
    name: '',
    brand: '',
    category_id: null,
    supplier_id: null,
    quantity_per_unit: null,
    unit: '',
    price: null,
    par_level: null,
    current_stock: null,
    notes: '',
  });

  const openModal = (item?: Item) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name,
        brand: item.brand || '',
        category_id: item.category_id,
        supplier_id: item.supplier_id,
        quantity_per_unit: item.quantity_per_unit,
        unit: item.unit || '',
        price: item.price,
        par_level: item.par_level,
        current_stock: item.current_stock,
        notes: item.notes || '',
      });
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        brand: '',
        category_id: null,
        supplier_id: null,
        quantity_per_unit: null,
        unit: '',
        price: null,
        par_level: null,
        current_stock: null,
        notes: '',
      });
    }
    setIsModalOpen(true);
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
      setIsModalOpen(false);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to save item');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      await deleteItem.mutateAsync(id);
      toast.success('Item deleted successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to delete item');
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Items</h1>
            <p className="text-gray-500 mt-1">Manage your inventory items</p>
          </div>
          <Button onClick={() => openModal()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={categoryFilter || ''}
              onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : undefined)}
            />
            <Select
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              value={supplierFilter || ''}
              onChange={(e) => setSupplierFilter(e.target.value ? Number(e.target.value) : undefined)}
            />
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setCategoryFilter(undefined);
                setSupplierFilter(undefined);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Qty/Unit</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                    <TableCell className="text-gray-500">{item.brand || '-'}</TableCell>
                    <TableCell className="text-gray-500">{item.category_name || '-'}</TableCell>
                    <TableCell className="text-gray-500">{item.supplier_name || '-'}</TableCell>
                    <TableCell className="text-gray-500">
                      {item.quantity_per_unit ? `${item.quantity_per_unit} ${item.unit || ''}` : '-'}
                    </TableCell>
                    <TableCell className="text-gray-900">{formatCurrency(item.price)}</TableCell>
                    <TableCell className="text-gray-500">
                      {item.current_stock !== null ? `${item.current_stock} ${item.unit || ''}` : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => openModal(item)}
                          className="text-gray-400 hover:text-primary-600"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingItem ? 'Edit Item' : 'Add Item'}
          size="lg"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <Input
                label="Brand"
                value={formData.brand || ''}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              />
              <Select
                label="Category"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                value={formData.category_id || ''}
                onChange={(e) =>
                  setFormData({ ...formData, category_id: e.target.value ? Number(e.target.value) : null })
                }
              />
              <Select
                label="Supplier"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={formData.supplier_id || ''}
                onChange={(e) =>
                  setFormData({ ...formData, supplier_id: e.target.value ? Number(e.target.value) : null })
                }
              />
              <Input
                label="Quantity per Unit"
                type="number"
                step="0.01"
                value={formData.quantity_per_unit || ''}
                onChange={(e) =>
                  setFormData({ ...formData, quantity_per_unit: e.target.value ? Number(e.target.value) : null })
                }
              />
              <Input
                label="Unit (OZ, LB, Count, etc.)"
                value={formData.unit || ''}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              />
              <Input
                label="Price"
                type="number"
                step="0.01"
                value={formData.price || ''}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value ? Number(e.target.value) : null })
                }
              />
              <Input
                label="Current Stock"
                type="number"
                step="0.01"
                value={formData.current_stock || ''}
                onChange={(e) =>
                  setFormData({ ...formData, current_stock: e.target.value ? Number(e.target.value) : null })
                }
              />
              <Input
                label="Par Level (Minimum Stock)"
                type="number"
                step="0.01"
                value={formData.par_level || ''}
                onChange={(e) =>
                  setFormData({ ...formData, par_level: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={createItem.isPending || updateItem.isPending}>
                {editingItem ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
