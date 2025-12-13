import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Receipt, CreateReceiptPayload, FinancialDashboard } from '@/types';

export function useReceipts(params?: { supplier_id?: number; order_id?: number }) {
  return useQuery({
    queryKey: ['receipts', params],
    queryFn: async () => {
      const response = await api.get<Receipt[]>('/receipts', { params });
      return response.data;
    },
  });
}

export function useReceipt(id: number) {
  return useQuery({
    queryKey: ['receipts', id],
    queryFn: async () => {
      const response = await api.get<Receipt>(`/receipts/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

export function useCreateReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateReceiptPayload) => {
      const response = await api.post<Receipt>('/receipts', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useUploadReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await api.post<Receipt>('/receipts/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useUpdateReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Receipt> }) => {
      const response = await api.put<Receipt>(`/receipts/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useVerifyReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<Receipt>(`/receipts/${id}/verify`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useDeleteReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/receipts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useDeleteReceiptLineItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ receiptId, itemIndex }: { receiptId: number; itemIndex: number }) => {
      const response = await api.delete<Receipt>(`/receipts/${receiptId}/line-items/${itemIndex}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useFinancialDashboard(params?: { start_date?: string; end_date?: string }) {
  return useQuery({
    queryKey: ['financial-dashboard', params],
    queryFn: async () => {
      const response = await api.get<FinancialDashboard>('/receipts/financial-dashboard', { params });
      return response.data;
    },
  });
}

export function useReceiptProperties() {
  return useQuery({
    queryKey: ['receipt-properties'],
    queryFn: async () => {
      const response = await api.get<{ id: number; name: string; code: string }[]>('/receipts/properties');
      return response.data;
    },
  });
}

export function useReceiptOrdersByProperty(propertyId: number | null) {
  return useQuery({
    queryKey: ['receipt-orders', propertyId],
    queryFn: async () => {
      const response = await api.get<{
        id: number;
        order_number: string;
        status: string;
        week_of: string | null;
        item_count: number;
        estimated_total: number;
        created_at: string | null;
      }[]>(`/receipts/orders-by-property/${propertyId}`);
      return response.data;
    },
    enabled: !!propertyId,
  });
}

// Add unmatched receipt item to inventory
export interface AddToInventoryPayload {
  name: string;
  property_id: number;
  supplier_id?: number;
  category?: string;
  unit?: string;
  unit_price?: number;
  par_level?: number;
  is_recurring?: boolean;
}

export function useAddToInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: AddToInventoryPayload) => {
      const response = await api.post('/receipts/add-to-inventory', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
