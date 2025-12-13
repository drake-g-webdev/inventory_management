import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Item, CreateItemPayload } from '@/types';

export function useItems(params?: { search?: string; category_id?: number; supplier_id?: number }) {
  return useQuery({
    queryKey: ['items', params],
    queryFn: async () => {
      const response = await api.get<Item[]>('/items', { params });
      return response.data;
    },
  });
}

export function useItem(id: number) {
  return useQuery({
    queryKey: ['items', id],
    queryFn: async () => {
      const response = await api.get<Item>(`/items/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateItemPayload) => {
      const response = await api.post<Item>('/items', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<CreateItemPayload> }) => {
      const response = await api.put<Item>(`/items/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}
