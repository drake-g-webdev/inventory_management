'use client';

import { useState, useRef } from 'react';
import { Plus, Edit2, Trash2, Package, Search, Upload, Download, Link, Unlink, RefreshCw, Building2, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import {
  useMasterProducts,
  useMasterProduct,
  useCreateMasterProduct,
  useUpdateMasterProduct,
  useDeleteMasterProduct,
  useAssignMasterProduct,
  useUnassignMasterProduct,
  useSyncFromMaster,
  useSeedFromProperty,
  useUploadMasterProductsCSV,
  useUnlinkedInventoryItems,
  useCleanupNonRecurring
} from '@/hooks/useMasterProducts';
import { useProperties } from '@/hooks/useProperties';
import { useSuppliers } from '@/hooks/useSuppliers';
import type { MasterProduct, CreateMasterProductPayload, Property } from '@/types';
import toast from 'react-hot-toast';
import { UNITS } from '@/lib/constants';

const SUBCATEGORIES: Record<string, string[]> = {
  'Beverages': ['BIB', 'Cans/Bottles', 'Dry', 'Concentrate'],
};

function groupByCategory(items: MasterProduct[]) {
  return items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, MasterProduct[]>);
}

function groupBySubcategory(items: MasterProduct[]) {
  return items.reduce((acc, item) => {
    const subcategory = item.subcategory || 'Other';
    if (!acc[subcategory]) acc[subcategory] = [];
    acc[subcategory].push(item);
    return acc;
  }, {} as Record<string, MasterProduct[]>);
}

export default function MasterProductsPage() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const { data: products = [], isLoading, refetch } = useMasterProducts({
    search: search || undefined,
    category: selectedCategory || undefined
  });
  const { data: properties = [] } = useProperties();
  const { data: suppliers = [] } = useSuppliers();
  const { data: unlinkedItems = [] } = useUnlinkedInventoryItems();

  const createProduct = useCreateMasterProduct();
  const updateProduct = useUpdateMasterProduct();
  const deleteProduct = useDeleteMasterProduct();
  const assignProduct = useAssignMasterProduct();
  const unassignProduct = useUnassignMasterProduct();
  const syncFromMaster = useSyncFromMaster();
  const seedFromProperty = useSeedFromProperty();
  const uploadCSV = useUploadMasterProductsCSV();
  const cleanupNonRecurring = useCleanupNonRecurring();

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const [editingProduct, setEditingProduct] = useState<MasterProduct | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<MasterProduct | null>(null);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([]);
  const [seedPropertyId, setSeedPropertyId] = useState<number | ''>('');

  // Collapsible state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSubcategories, setExpandedSubcategories] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<CreateMasterProductPayload>({
    name: '',
    sku: '',
    category: '',
    subcategory: '',
    seasonal_availability: 'year_round',
    description: '',
    brand: '',
    qty: '',
    product_notes: '',
    supplier_id: null,
    unit: 'unit',
    order_unit: '',
    units_per_order_unit: null,
    unit_price: null,
    default_par_level: null,
    default_order_at: null,
  });

  // Get product details for assignment modal
  const { data: productDetails } = useMasterProduct(selectedProduct?.id || 0);

  // Get unique categories
  const categories = Array.from(new Set(products.map(p => p.category).filter((c): c is string => Boolean(c))));

  // Group products by category
  const groupedProducts = groupByCategory(products);

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
    setExpandedCategories(new Set(Object.keys(groupedProducts)));
    const allSubcategoryKeys: string[] = [];
    Object.entries(groupedProducts).forEach(([category, categoryProducts]) => {
      if (SUBCATEGORIES[category]) {
        const subcategoryGroups = groupBySubcategory(categoryProducts);
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

  const handleOpenEditModal = (product?: MasterProduct) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        sku: product.sku || '',
        category: product.category || '',
        subcategory: product.subcategory || '',
        seasonal_availability: product.seasonal_availability || 'year_round',
        description: product.description || '',
        brand: product.brand || '',
        qty: product.qty || '',
        product_notes: product.product_notes || '',
        supplier_id: product.supplier_id,
        unit: product.unit,
        order_unit: product.order_unit || '',
        units_per_order_unit: product.units_per_order_unit,
        unit_price: product.unit_price,
        default_par_level: product.default_par_level,
        default_order_at: product.default_order_at,
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        sku: '',
        category: '',
        subcategory: '',
        seasonal_availability: 'year_round',
        description: '',
        brand: '',
        qty: '',
        product_notes: '',
        supplier_id: null,
        unit: 'unit',
        order_unit: '',
        units_per_order_unit: null,
        unit_price: null,
        default_par_level: null,
        default_order_at: null,
      });
    }
    setShowEditModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        sku: formData.sku || null,
        category: formData.category || null,
        subcategory: formData.subcategory || null,
        description: formData.description || null,
        brand: formData.brand || null,
        product_notes: formData.product_notes || null,
        order_unit: formData.order_unit || null,
      };

      if (editingProduct) {
        await updateProduct.mutateAsync({ id: editingProduct.id, data: payload });
        toast.success('Product updated successfully');
      } else {
        await createProduct.mutateAsync(payload);
        toast.success('Product created successfully');
      }
      // Auto-expand the category
      if (formData.category) {
        setExpandedCategories(prev => new Set([...Array.from(prev), formData.category!]));
        if (formData.subcategory) {
          setExpandedSubcategories(prev => new Set([...Array.from(prev), `${formData.category}:${formData.subcategory}`]));
        }
      }
      setShowEditModal(false);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this master product?')) return;
    try {
      await deleteProduct.mutateAsync(id);
      toast.success('Product deleted successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Delete failed');
    }
  };

  const handleOpenAssignModal = (product: MasterProduct) => {
    setSelectedProduct(product);
    setSelectedPropertyIds([]);
    setShowAssignModal(true);
  };

  const handleAssign = async () => {
    if (!selectedProduct || selectedPropertyIds.length === 0) return;
    try {
      const result = await assignProduct.mutateAsync({
        id: selectedProduct.id,
        request: { property_ids: selectedPropertyIds }
      });
      toast.success(result.message);
      setShowAssignModal(false);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Assignment failed');
    }
  };

  const handleSyncFromMaster = async (inventoryItemIds: number[]) => {
    try {
      const result = await syncFromMaster.mutateAsync({
        inventory_item_ids: inventoryItemIds
      });
      toast.success(result.message);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Sync failed');
    }
  };

  const handleUnassign = async (productId: number, propertyId: number, propertyName: string) => {
    if (!confirm(`Remove this product from ${propertyName}? This will delete the inventory item.`)) return;
    try {
      const result = await unassignProduct.mutateAsync({ productId, propertyId });
      toast.success(result.message);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Unassign failed');
    }
  };

  const handleSeedFromProperty = async () => {
    if (!seedPropertyId) return;
    try {
      const result = await seedFromProperty.mutateAsync({
        property_id: seedPropertyId as number
      });
      toast.success(`Created ${result.created_count} products, linked ${result.linked_count} existing`);
      setShowSeedModal(false);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Seed failed');
    }
  };

  const handleCleanupNonRecurring = async () => {
    if (!confirm('This will delete master products that only have non-recurring items. Continue?')) return;
    try {
      const result = await cleanupNonRecurring.mutateAsync();
      toast.success(`Deleted ${result.deleted_master_products} products, unlinked ${result.unlinked_items} items`);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Cleanup failed');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await uploadCSV.mutateAsync(file);
      toast.success(`Created ${result.created_count}, updated ${result.updated_count}`);
      if (result.errors.length > 0) {
        console.error('Upload errors:', result.errors);
      }
      setShowUploadModal(false);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Upload failed');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleViewDetails = (product: MasterProduct) => {
    setSelectedProduct(product);
    setShowDetailsModal(true);
  };

  // Properties not yet assigned to selected product
  const unassignedProperties = properties.filter(prop =>
    !productDetails?.assignments?.some(a => a.property_id === prop.id)
  );

  // Render a product row
  const renderProductRow = (product: MasterProduct) => (
    <tr key={product.id} className="hover:bg-gray-50">
      <td className="px-6 py-4">
        <div>
          <p className="font-medium text-gray-900">
            {product.name}
            {product.qty && <span className="text-gray-500 ml-1">- {product.qty}</span>}
          </p>
          {product.brand && (
            <p className="text-sm text-purple-600">{product.brand}</p>
          )}
          {product.sku && (
            <p className="text-xs text-gray-400">SKU: {product.sku}</p>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">
        {product.unit}
        {product.order_unit && product.order_unit !== product.unit && (
          <span className="text-gray-400"> (order: {product.order_unit})</span>
        )}
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">
        {product.supplier_name || '-'}
      </td>
      <td className="px-6 py-4 text-center">
        <button
          onClick={() => handleViewDetails(product)}
          className="inline-flex items-center px-2 py-1 text-sm rounded-full bg-blue-100 text-blue-800 hover:bg-blue-200"
        >
          <Building2 className="h-3 w-3 mr-1" />
          {product.assigned_property_count}
        </button>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex justify-end gap-2">
          <button
            onClick={() => handleOpenAssignModal(product)}
            className="text-blue-600 hover:text-blue-900 p-1"
            title="Assign to properties"
          >
            <Link className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleOpenEditModal(product)}
            className="text-primary-600 hover:text-primary-900 p-1"
            title="Edit"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDelete(product.id)}
            className="text-red-600 hover:text-red-900 p-1"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <RoleGuard allowedRoles={['admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Master Products</h1>
              <p className="text-gray-500 mt-1">
                Organization-wide product catalog - {products.length} products
                {unlinkedItems.length > 0 && (
                  <span className="ml-2 text-amber-600">({unlinkedItems.length} unlinked items)</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleCleanupNonRecurring}
                disabled={cleanupNonRecurring.isPending}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {cleanupNonRecurring.isPending ? 'Cleaning...' : 'Cleanup Non-Recurring'}
              </Button>
              <Button variant="outline" onClick={() => setShowSeedModal(true)}>
                <Download className="h-4 w-4 mr-2" />
                Seed from Camp
              </Button>
              <Button variant="outline" onClick={() => setShowUploadModal(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Upload CSV
              </Button>
              <Button onClick={() => handleOpenEditModal()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
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
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Products by Category */}
          {isLoading ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">Loading...</div>
          ) : products.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No master products found</p>
              <p className="text-sm text-gray-400 mt-1">Create products or seed from an existing camp inventory</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedProducts)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([category, categoryProducts]) => {
                  const isExpanded = expandedCategories.has(category);

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
                            ({categoryProducts.length} products)
                          </span>
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="divide-y divide-gray-100">
                          {/* Check if this category has subcategories */}
                          {SUBCATEGORIES[category] ? (
                            // Render with subcategory collapsibles
                            <div className="divide-y divide-gray-200">
                              {Object.entries(groupBySubcategory(categoryProducts))
                                .sort(([a], [b]) => {
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
                                .map(([subcategory, subcategoryProducts]) => {
                                  const subKey = `${category}:${subcategory}`;
                                  const isSubExpanded = expandedSubcategories.has(subKey);

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
                                            ({subcategoryProducts.length} products)
                                          </span>
                                        </button>
                                      </div>

                                      {isSubExpanded && (
                                        <table className="min-w-full">
                                          <thead className="bg-gray-50">
                                            <tr>
                                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                                              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Assigned</th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                                            </tr>
                                          </thead>
                                          <tbody className="bg-white divide-y divide-gray-200">
                                            {subcategoryProducts.map(renderProductRow)}
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
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Assigned</th>
                                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {categoryProducts.map(renderProductRow)}
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

          {/* Summary */}
          {products.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
              <strong>Master Products</strong>: {products.length} total products across {Object.keys(groupedProducts).length} categories
            </div>
          )}
        </div>

        {/* Edit/Create Modal */}
        <Modal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          title={editingProduct ? 'Edit Master Product' : 'Add Master Product'}
          size="lg"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="name"
                label="Product Name *"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <Input
                id="sku"
                label="SKU"
                value={formData.sku || ''}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                id="category"
                label="Category"
                value={formData.category || ''}
                onChange={(e) => setFormData({ ...formData, category: e.target.value, subcategory: '' })}
                list="categories"
              />
              <datalist id="categories">
                {categories.map(cat => <option key={cat} value={cat} />)}
              </datalist>

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
                <Input
                  id="subcategory"
                  label="Subcategory"
                  value={formData.subcategory || ''}
                  onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Seasonal Availability</label>
              <select
                value={formData.seasonal_availability || 'year_round'}
                onChange={(e) => setFormData({ ...formData, seasonal_availability: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="year_round">Year Round</option>
                <option value="midnight_sun">Midnight Sun (Summer)</option>
                <option value="aurora">Aurora (Winter)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                id="brand"
                label="Preferred Brand"
                value={formData.brand || ''}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              />
              <Input
                id="qty"
                label="Qty (e.g., 50#, 5 Gal)"
                value={formData.qty || ''}
                onChange={(e) => setFormData({ ...formData, qty: e.target.value })}
                placeholder="50#"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Supplier</label>
                <select
                  value={formData.supplier_id || ''}
                  onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">-- Select Supplier --</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product Notes</label>
              <textarea
                value={formData.product_notes || ''}
                onChange={(e) => setFormData({ ...formData, product_notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="e.g., individually wrapped, organic preferred"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Inventory Unit *</label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Order Unit</label>
                <select
                  value={formData.order_unit || ''}
                  onChange={(e) => setFormData({ ...formData, order_unit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Same as inventory</option>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <Input
                id="units_per_order_unit"
                label="Units per Order Unit"
                type="number"
                min="1"
                step="1"
                value={formData.units_per_order_unit || ''}
                onChange={(e) => setFormData({ ...formData, units_per_order_unit: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                id="unit_price"
                label="Default Unit Price"
                type="number"
                min="0"
                step="0.01"
                value={formData.unit_price || ''}
                onChange={(e) => setFormData({ ...formData, unit_price: e.target.value ? parseFloat(e.target.value) : null })}
              />
              <Input
                id="default_par_level"
                label="Default Par (order up to)"
                type="number"
                min="0"
                step="0.5"
                value={formData.default_par_level || ''}
                onChange={(e) => setFormData({ ...formData, default_par_level: e.target.value ? parseFloat(e.target.value) : null })}
              />
              <Input
                id="default_order_at"
                label="Default Order At (trigger at)"
                type="number"
                min="0"
                step="0.5"
                value={formData.default_order_at || ''}
                onChange={(e) => setFormData({ ...formData, default_order_at: e.target.value ? parseFloat(e.target.value) : null })}
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
              <Button type="submit" isLoading={createProduct.isPending || updateProduct.isPending}>
                {editingProduct ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Modal>

        {/* Assign Modal */}
        <Modal
          isOpen={showAssignModal}
          onClose={() => setShowAssignModal(false)}
          title={`Assign "${selectedProduct?.name}" to Properties`}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Select properties to add this product to their inventory.
              Already assigned: {productDetails?.assigned_property_count || 0} properties
            </p>

            {unassignedProperties.length === 0 ? (
              <p className="text-center py-4 text-gray-500">All properties already have this product</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {unassignedProperties.map(prop => (
                  <label key={prop.id} className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPropertyIds.includes(prop.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPropertyIds([...selectedPropertyIds, prop.id]);
                        } else {
                          setSelectedPropertyIds(selectedPropertyIds.filter(id => id !== prop.id));
                        }
                      }}
                      className="h-4 w-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                    />
                    <span className="ml-3">
                      <span className="font-medium">{prop.name}</span>
                      <span className="ml-2 text-sm text-gray-400">({prop.code})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAssignModal(false)}>Cancel</Button>
              <Button
                onClick={handleAssign}
                disabled={selectedPropertyIds.length === 0}
                isLoading={assignProduct.isPending}
              >
                Assign to {selectedPropertyIds.length} Properties
              </Button>
            </div>
          </div>
        </Modal>

        {/* Seed from Property Modal */}
        <Modal
          isOpen={showSeedModal}
          onClose={() => setShowSeedModal(false)}
          title="Seed Master Products from Camp"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Create master products from an existing camp's inventory. This will create new master products
              and link the camp's items to them.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Camp</label>
              <select
                value={seedPropertyId}
                onChange={(e) => setSeedPropertyId(e.target.value ? parseInt(e.target.value) : '')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">-- Select a camp --</option>
                {properties.map(prop => (
                  <option key={prop.id} value={prop.id}>{prop.name} ({prop.code})</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowSeedModal(false)}>Cancel</Button>
              <Button
                onClick={handleSeedFromProperty}
                disabled={!seedPropertyId}
                isLoading={seedFromProperty.isPending}
              >
                Seed Products
              </Button>
            </div>
          </div>
        </Modal>

        {/* Upload CSV Modal */}
        <Modal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          title="Upload Master Products CSV"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Upload a CSV file to create or update master products. Required column: <code>name</code>.
              Optional columns: sku, category, subcategory, brand, product_notes, supplier_name, unit, order_unit, units_per_order_unit, unit_price, default_par_level, default_order_at
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
            />

            {uploadCSV.isPending && (
              <p className="text-sm text-gray-500">Uploading...</p>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowUploadModal(false)}>Close</Button>
            </div>
          </div>
        </Modal>

        {/* Product Details Modal */}
        <Modal
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          title={`${selectedProduct?.name} - Assignments`}
          size="lg"
        >
          {productDetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded-lg">
                <div>
                  <span className="text-gray-500">Category:</span>{' '}
                  <span className="font-medium">{productDetails.category || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Unit:</span>{' '}
                  <span className="font-medium">{productDetails.unit}</span>
                </div>
                <div>
                  <span className="text-gray-500">Brand:</span>{' '}
                  <span className="font-medium">{productDetails.brand || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Supplier:</span>{' '}
                  <span className="font-medium">{productDetails.supplier_name || '-'}</span>
                </div>
              </div>

              <h4 className="font-medium text-gray-900">Property Assignments ({productDetails.assignments.length})</h4>

              {productDetails.assignments.length === 0 ? (
                <p className="text-center py-4 text-gray-500">Not assigned to any properties yet</p>
              ) : (
                <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {productDetails.assignments.map(assignment => (
                    <div key={assignment.inventory_item_id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <span className="font-medium">{assignment.property_name}</span>
                        <span className="ml-2 text-sm text-gray-400">({assignment.property_code})</span>
                        <div className="text-sm text-gray-500">
                          Stock: {assignment.current_stock} | Par: {assignment.par_level || '-'} | Order At: {assignment.order_at || '-'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {assignment.is_synced ? (
                          <span className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                            <Check className="h-3 w-3 mr-1" />
                            Synced
                          </span>
                        ) : (
                          <>
                            <span className="inline-flex items-center px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800">
                              <X className="h-3 w-3 mr-1" />
                              Out of sync
                            </span>
                            <button
                              onClick={() => handleSyncFromMaster([assignment.inventory_item_id])}
                              className="text-xs text-blue-600 hover:text-blue-800 underline"
                            >
                              Sync now
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleUnassign(selectedProduct!.id, assignment.property_id, assignment.property_name)}
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                          title="Remove from property"
                        >
                          <Unlink className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => {
                  setShowDetailsModal(false);
                  handleOpenAssignModal(selectedProduct!);
                }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Assign to More Properties
                </Button>
                <Button variant="outline" onClick={() => setShowDetailsModal(false)}>Close</Button>
              </div>
            </div>
          )}
        </Modal>
      </DashboardLayout>
    </RoleGuard>
  );
}
