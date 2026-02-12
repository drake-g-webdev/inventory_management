'use client';

import { AlertTriangle, Package, ExternalLink, ArrowLeft, CheckCircle, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RoleGuard from '@/components/auth/RoleGuard';
import Button from '@/components/ui/Button';
import { useFlaggedItems, useResolveFlaggedItem } from '@/hooks/useOrders';
import { useProperties } from '@/hooks/useProperties';
import { useState } from 'react';
import type { FlaggedItem } from '@/types';
import toast from 'react-hot-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8005';

// Helper to get full image URL from relative path
const getImageUrl = (path: string | null) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${API_URL}${path}`;
};

export default function FlaggedItemsPage() {
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>(undefined);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const { data: flaggedData, isLoading } = useFlaggedItems(selectedPropertyId);
  const { data: properties = [] } = useProperties();
  const resolveFlaggedItem = useResolveFlaggedItem();

  const handleResolve = async (itemId: number, itemName: string) => {
    if (!confirm(`Are you sure you want to mark "${itemName}" as resolved? This will remove it from the flagged items list.`)) {
      return;
    }
    try {
      await resolveFlaggedItem.mutateAsync(itemId);
      toast.success(`"${itemName}" resolved successfully`);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to resolve item');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Group items by property for better organization
  const groupedByProperty = (flaggedData?.items || []).reduce((acc, item) => {
    const key = item.property_name;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {} as Record<string, FlaggedItem[]>);

  return (
    <RoleGuard allowedRoles={['purchasing_team', 'purchasing_supervisor', 'admin']}>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <AlertTriangle className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Flagged Items</h1>
                  <p className="text-gray-500">Items reported with quality or delivery issues</p>
                </div>
              </div>
            </div>
            <Link href="/orders/all">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Orders
              </Button>
            </Link>
          </div>

          {/* Filter by property */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Property
            </label>
            <select
              value={selectedPropertyId || ''}
              onChange={(e) => setSelectedPropertyId(e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All Properties</option>
              {properties.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
            </select>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="text-sm text-gray-500">Total Flagged Items</div>
              <div className="text-3xl font-bold text-amber-600">{flaggedData?.total_count || 0}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="text-sm text-gray-500">Properties Affected</div>
              <div className="text-3xl font-bold text-gray-900">{Object.keys(groupedByProperty).length}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="text-sm text-gray-500">Unique Orders</div>
              <div className="text-3xl font-bold text-gray-900">
                {new Set(flaggedData?.items.map(i => i.order_id)).size || 0}
              </div>
            </div>
          </div>

          {/* Flagged Items List */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">Loading...</div>
            ) : flaggedData?.items.length === 0 ? (
              <div className="p-8 text-center">
                <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-2">No flagged items</p>
                <p className="text-sm text-gray-400">
                  Items flagged by camp workers during receiving will appear here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {Object.entries(groupedByProperty).map(([propertyName, items]) => (
                  <div key={propertyName}>
                    <div className="px-6 py-3 bg-gray-50 border-b">
                      <h3 className="font-semibold text-gray-900">{propertyName}</h3>
                      <p className="text-sm text-gray-500">{items.length} flagged item(s)</p>
                    </div>

                    {items.map((item) => (
                      <div key={item.item_id} className="p-6 hover:bg-gray-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertTriangle className="h-5 w-5 text-amber-500" />
                              <span className="font-semibold text-gray-900">{item.item_name}</span>
                              <button
                                onClick={() => handleResolve(item.item_id, item.item_name)}
                                disabled={resolveFlaggedItem.isPending}
                                className="ml-auto inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-xs font-medium rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle className="h-3 w-3" />
                                Resolve
                              </button>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3">
                              <p className="text-amber-800">
                                <strong>{item.property_name}</strong> flagged <strong>{item.item_name}</strong>:
                              </p>
                              <p className="text-amber-900 mt-1 italic">
                                &ldquo;{item.issue_description || 'No description provided'}&rdquo;
                              </p>
                              {item.issue_photo_url && (
                                <div className="mt-3">
                                  <button
                                    onClick={() => setViewingPhoto(getImageUrl(item.issue_photo_url))}
                                    className="inline-flex items-center gap-2 text-amber-700 hover:text-amber-900"
                                  >
                                    <ImageIcon className="h-4 w-4" />
                                    <span className="text-sm font-medium underline">View Photo</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-gray-500">Order:</span>{' '}
                                <Link
                                  href={`/orders/${item.order_id}`}
                                  className="text-primary-600 hover:underline inline-flex items-center"
                                >
                                  {item.order_number}
                                  <ExternalLink className="h-3 w-3 ml-1" />
                                </Link>
                              </div>
                              <div>
                                <span className="text-gray-500">Qty Received:</span>{' '}
                                <span className="font-medium">{item.received_quantity}</span>
                                {item.approved_quantity && item.received_quantity !== item.approved_quantity && (
                                  <span className="text-red-600 ml-1">
                                    (expected {item.approved_quantity})
                                  </span>
                                )}
                              </div>
                              <div>
                                <span className="text-gray-500">Reported by:</span>{' '}
                                <span className="font-medium">{item.flagged_by_name || 'Unknown'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Date:</span>{' '}
                                <span className="font-medium">{formatDate(item.received_at)}</span>
                              </div>
                            </div>

                            {item.receiving_notes && (
                              <div className="mt-3 text-sm text-gray-600">
                                <span className="font-medium">Additional Notes:</span> {item.receiving_notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Photo Viewer Modal */}
        {viewingPhoto && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
            onClick={() => setViewingPhoto(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] p-4">
              <button
                onClick={() => setViewingPhoto(null)}
                className="absolute top-2 right-2 p-2 bg-white rounded-full text-gray-800 hover:bg-gray-200 shadow-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <img
                src={viewingPhoto}
                alt="Issue photo"
                className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
      </DashboardLayout>
    </RoleGuard>
  );
}
