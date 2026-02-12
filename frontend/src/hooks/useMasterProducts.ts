import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  MasterProduct,
  MasterProductWithAssignments,
  CreateMasterProductPayload,
  UpdateMasterProductPayload,
  AssignMasterProductRequest,
  SyncFromMasterRequest,
  SeedFromPropertyRequest,
  UnlinkedInventoryItem
} from '@/types';

export function useMasterProducts(params?: { category?: string; supplier_id?: number; search?: string }) {
  return useQuery({
    queryKey: ['master-products', params],
    queryFn: async () => {
      const response = await api.get<MasterProduct[]>('/master-products', { params });
      return response.data;
    },
  });
}

export function useMasterProduct(id: number) {
  return useQuery({
    queryKey: ['master-products', id],
    queryFn: async () => {
      const response = await api.get<MasterProductWithAssignments>(`/master-products/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

export function useMasterProductCategories() {
  return useQuery({
    queryKey: ['master-products', 'categories'],
    queryFn: async () => {
      const response = await api.get<string[]>('/master-products/categories');
      return response.data;
    },
  });
}

export function useCreateMasterProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateMasterProductPayload) => {
      const response = await api.post<MasterProduct>('/master-products', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
    },
  });
}

export function useUpdateMasterProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateMasterProductPayload }) => {
      const response = await api.put<MasterProduct>(`/master-products/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
    },
  });
}

export function useDeleteMasterProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/master-products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
    },
  });
}

export function useAssignMasterProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, request }: { id: number; request: AssignMasterProductRequest }) => {
      const response = await api.post(`/master-products/${id}/assign`, request);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUnassignMasterProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, propertyId }: { productId: number; propertyId: number }) => {
      const response = await api.delete(`/master-products/${productId}/unassign/${propertyId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useSyncFromMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SyncFromMasterRequest) => {
      const response = await api.post('/master-products/sync-from-master', request);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useSyncAllFromMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post('/master-products/sync-all');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useSeedFromProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SeedFromPropertyRequest) => {
      const response = await api.post('/master-products/seed-from-property', request);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUploadMasterProductsCSV() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post('/master-products/upload-csv', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
    },
  });
}

export function useUnlinkedInventoryItems(propertyId?: number) {
  return useQuery({
    queryKey: ['master-products', 'unlinked-items', propertyId],
    queryFn: async () => {
      const params = propertyId ? { property_id: propertyId } : {};
      const response = await api.get<UnlinkedInventoryItem[]>('/master-products/unlinked-items', { params });
      return response.data;
    },
  });
}

export function useCleanupNonRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.delete('/master-products/cleanup-non-recurring');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
