'use client';

import { useState } from 'react';
import { Plus, Edit2, Trash2, Building2, Download } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { useProperties, useCreateProperty, useUpdateProperty, useDeleteProperty } from '@/hooks/useProperties';
import type { Property, CreatePropertyPayload } from '@/types';
import toast from 'react-hot-toast';
import api from '@/lib/api';

export default function PropertiesPage() {
  const { data: properties = [], isLoading } = useProperties();
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();

  const [showModal, setShowModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [formData, setFormData] = useState<CreatePropertyPayload>({
    name: '',
    code: '',
    address: '',
  });

  const handleOpenModal = (property?: Property) => {
    if (property) {
      setEditingProperty(property);
      setFormData({
        name: property.name,
        code: property.code,
        address: property.address || '',
      });
    } else {
      setEditingProperty(null);
      setFormData({
        name: '',
        code: '',
        address: '',
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProperty) {
        await updateProperty.mutateAsync({ id: editingProperty.id, data: formData });
        toast.success('Property updated successfully');
      } else {
        await createProperty.mutateAsync(formData);
        toast.success('Property created successfully');
      }
      setShowModal(false);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this property? This will affect all related data.')) return;
    try {
      await deleteProperty.mutateAsync(id);
      toast.success('Property deleted successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Delete failed');
    }
  };

  const handleExportInventory = async (property: Property) => {
    try {
      const response = await api.get(`/inventory/export/${property.id}`, {
        responseType: 'blob'
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `inventory_${property.code}_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${property.name} inventory`);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Export failed');
    }
  };

  return (
    <RoleGuard allowedRoles={['admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
              <p className="text-gray-500 mt-1">Manage camp locations and properties</p>
            </div>
            <Button onClick={() => handleOpenModal()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Property
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isLoading ? (
              <div className="col-span-full p-8 text-center">Loading...</div>
            ) : properties.length === 0 ? (
              <div className="col-span-full p-8 text-center text-gray-500">No properties found</div>
            ) : (
              properties.map((property) => (
                <div key={property.id} className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div className="p-3 rounded-lg bg-primary-100">
                        <Building2 className="h-6 w-6 text-primary-600" />
                      </div>
                      <div className="ml-4">
                        <h3 className="font-semibold text-gray-900">{property.name}</h3>
                        <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                          {property.code}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleExportInventory(property)}
                        className="text-green-600 hover:text-green-900"
                        title="Export inventory to CSV"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleOpenModal(property)} className="text-primary-600 hover:text-primary-900">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(property.id)} className="text-red-600 hover:text-red-900">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {property.address && (
                    <p className="mt-4 text-sm text-gray-500">{property.address}</p>
                  )}
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${property.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {property.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Add/Edit Property Modal */}
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingProperty ? 'Edit Property' : 'Add Property'}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="name"
              label="Property Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Main Camp"
              required
            />
            <Input
              id="code"
              label="Property Code"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="MAIN"
              required
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea
                value={formData.address || ''}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="123 Camp Road, City, State"
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" isLoading={createProperty.isPending || updateProperty.isPending}>
                {editingProperty ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
