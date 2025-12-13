import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Order, CreateOrderPayload, OrderStatus, SupplierPurchaseList, FlaggedItemsList, ReceiveItemPayload } from '@/types';

export function useOrders(params?: { property_id?: number; status?: OrderStatus }) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: async () => {
      const response = await api.get<Order[]>('/orders', { params });
      return response.data;
    },
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: ['orders', 'my'],
    queryFn: async () => {
      const response = await api.get<Order[]>('/orders/my-orders');
      return response.data;
    },
  });
}

export function usePendingReviewOrders() {
  return useQuery({
    queryKey: ['orders', 'pending-review'],
    queryFn: async () => {
      const response = await api.get<Order[]>('/orders/pending-review');
      return response.data;
    },
  });
}

export function useOrder(id: number) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: async () => {
      const response = await api.get<Order>(`/orders/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateOrderPayload) => {
      const response = await api.post<Order>('/orders', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<CreateOrderPayload> }) => {
      const response = await api.put<Order>(`/orders/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useSubmitOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<Order>(`/orders/${id}/submit`, {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useReviewOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, review_notes }: { id: number; action: 'approve' | 'request_changes'; review_notes?: string }) => {
      const response = await api.post<Order>(`/orders/${id}/review`, { action, review_notes });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useResubmitOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes?: string }) => {
      const response = await api.post<Order>(`/orders/${id}/resubmit`, { notes });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useMarkOrderOrdered() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<Order>(`/orders/${id}/mark-ordered`, {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useReceiveOrderItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, items }: { id: number; items: { item_id: number; received_quantity: number; has_issue?: boolean; issue_description?: string; receiving_notes?: string }[] }) => {
      const response = await api.post<Order>(`/orders/${id}/receive`, { items });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUpdateOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, itemId, data }: { orderId: number; itemId: number; data: { quantity_approved?: number; review_notes?: string } }) => {
      const response = await api.put(`/orders/${orderId}/items/${itemId}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useGenerateSupplierList() {
  return useMutation({
    mutationFn: async (orderIds: number[]) => {
      const response = await api.post('/orders/generate-supplier-list', { order_ids: orderIds });
      return response.data;
    },
  });
}

export function useSupplierPurchaseList(orderIds?: number[]) {
  return useQuery({
    queryKey: ['supplier-purchase-list', orderIds],
    queryFn: async () => {
      const params = orderIds?.length ? { order_ids: orderIds.join(',') } : {};
      const response = await api.get<SupplierPurchaseList>('/orders/supplier-purchase-list', { params });
      return response.data;
    },
  });
}

export function useFlaggedItems(propertyId?: number) {
  return useQuery({
    queryKey: ['flagged-items', propertyId],
    queryFn: async () => {
      const params = propertyId ? { property_id: propertyId } : {};
      const response = await api.get<FlaggedItemsList>('/orders/flagged-items', { params });
      return response.data;
    },
  });
}

export function useOrdersReadyToReceive() {
  return useQuery({
    queryKey: ['orders', 'ready-to-receive'],
    queryFn: async () => {
      // Get orders that are ordered or partially received
      const orderedResponse = await api.get<Order[]>('/orders', { params: { status: 'ordered' } });
      const partialResponse = await api.get<Order[]>('/orders', { params: { status: 'partially_received' } });
      return [...orderedResponse.data, ...partialResponse.data];
    },
  });
}
