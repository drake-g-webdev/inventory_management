import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Order, CreateOrderPayload, OrderStatus, SupplierPurchaseList, FlaggedItemsList, ReceiveItemPayload, UnreceivedItemsList } from '@/types';

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

export function useWithdrawOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<Order>(`/orders/${id}/withdraw`, {});
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

export function useUnmarkOrderOrdered() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post<Order>(`/orders/${id}/unmark-ordered`, {});
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
    mutationFn: async ({ id, items, finalize = false }: { id: number; items: { item_id: number; received_quantity: number; has_issue?: boolean; issue_description?: string; issue_photo_url?: string; receiving_notes?: string }[]; finalize?: boolean }) => {
      const response = await api.post<Order>(`/orders/${id}/receive`, { items, finalize });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      // Only invalidate inventory if finalizing (when stock actually updates)
      if (variables.finalize) {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      }
    },
  });
}

export function useUploadIssuePhoto() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      // For file uploads, we need axios to auto-detect FormData and set the proper
      // multipart/form-data header with boundary. We explicitly set to undefined
      // to override the default application/json header.
      const response = await api.post<{ url: string }>(
        '/orders/upload-issue-photo',
        formData,
        {
          headers: {
            'Content-Type': undefined as unknown as string,
          },
        }
      );
      return response.data;
    },
  });
}

export function useUpdateOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, itemId, data }: { orderId: number; itemId: number; data: { approved_quantity?: number; reviewer_notes?: string; supplier_id?: number } }) => {
      const response = await api.put(`/orders/${orderId}/items/${itemId}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useUpdateDraftOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, itemId, quantity, unit }: { orderId: number; itemId: number; quantity: number; unit?: string }) => {
      const params: { quantity: number; unit?: string } = { quantity };
      if (unit) {
        params.unit = unit;
      }
      const response = await api.patch(`/orders/${orderId}/items/${itemId}`, null, { params });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useDeleteOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, itemId }: { orderId: number; itemId: number }) => {
      await api.delete(`/orders/${orderId}/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useAddOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, item }: { orderId: number; item: { inventory_item_id?: number; custom_item_name?: string; requested_quantity: number; unit?: string; flag?: string } }) => {
      const response = await api.post(`/orders/${orderId}/items`, item);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useAddReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, item }: { orderId: number; item: { inventory_item_id?: number; custom_item_name?: string; requested_quantity: number; unit?: string } }) => {
      const response = await api.post(`/orders/${orderId}/add-review-item`, item);
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

export function useResolveFlaggedItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: number) => {
      const response = await api.post(`/orders/items/${itemId}/resolve-flag`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-items'] });
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

export function useAddReceivingItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, item }: { orderId: number; item: { inventory_item_id?: number; custom_item_name?: string; requested_quantity: number; unit?: string } }) => {
      const response = await api.post<Order>(`/orders/${orderId}/add-receiving-item`, item);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useUnreceivedItems(propertyId?: number) {
  return useQuery({
    queryKey: ['unreceived-items', propertyId],
    queryFn: async () => {
      // If propertyId is provided, get items for that property, otherwise get all
      const url = propertyId
        ? `/orders/unreceived-items/${propertyId}`
        : '/orders/unreceived-items';
      const response = await api.get<UnreceivedItemsList>(url);
      return response.data;
    },
  });
}

export function useDismissShortage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderItemIds: number[]) => {
      const response = await api.post('/orders/dismiss-shortage', { order_item_ids: orderItemIds });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unreceived-items'] });
    },
  });
}
