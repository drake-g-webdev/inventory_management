import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { InventoryItem, CreateInventoryItemPayload, InventoryCount, CreateInventoryCountPayload } from '@/types';

// Inventory Items
export function useInventoryItems(propertyId?: number) {
  return useQuery({
    queryKey: ['inventory', propertyId],
    queryFn: async () => {
      const params: Record<string, any> = {};
      if (propertyId) params.property_id = propertyId;
      const response = await api.get<InventoryItem[]>('/inventory/items', { params });
      return response.data;
    },
  });
}

export function useInventoryItem(id: number) {
  return useQuery({
    queryKey: ['inventory', 'item', id],
    queryFn: async () => {
      const response = await api.get<InventoryItem>(`/inventory/items/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateInventoryItemPayload) => {
      const response = await api.post<InventoryItem>('/inventory/items', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<CreateInventoryItemPayload> }) => {
      const response = await api.put<InventoryItem>(`/inventory/items/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/inventory/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useLowStockItems(propertyId?: number) {
  return useQuery({
    queryKey: ['inventory', 'low-stock', propertyId],
    queryFn: async () => {
      const params: Record<string, any> = { low_stock_only: true };
      if (propertyId) params.property_id = propertyId;
      const response = await api.get<InventoryItem[]>('/inventory/items', { params });
      return response.data;
    },
  });
}

// Inventory Counts
export function useInventoryCounts(propertyId?: number) {
  return useQuery({
    queryKey: ['inventory-counts', propertyId],
    queryFn: async () => {
      const params: Record<string, any> = {};
      if (propertyId) params.property_id = propertyId;
      const response = await api.get<InventoryCount[]>('/inventory/counts', { params });
      return response.data;
    },
  });
}

export function useInventoryCount(id: number) {
  return useQuery({
    queryKey: ['inventory-counts', id],
    queryFn: async () => {
      const response = await api.get<InventoryCount>(`/inventory/counts/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

export function useCreateInventoryCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateInventoryCountPayload) => {
      const response = await api.post<InventoryCount>('/inventory/counts', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-counts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUpdateInventoryCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<CreateInventoryCountPayload> }) => {
      const response = await api.put<InventoryCount>(`/inventory/counts/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-counts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
