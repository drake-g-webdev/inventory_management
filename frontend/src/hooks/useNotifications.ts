import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message?: string;
  link?: string;
  order_id?: number;
  order_item_id?: number;
  is_read: boolean;
  created_at: string;
  read_at?: string;
}

export interface NotificationList {
  notifications: Notification[];
  unread_count: number;
}

export function useNotifications(limit: number = 50, unreadOnly: boolean = false) {
  return useQuery({
    queryKey: ['notifications', limit, unreadOnly],
    queryFn: async () => {
      const response = await api.get<NotificationList>('/notifications', {
        params: { limit, unread_only: unreadOnly },
      });
      return response.data;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const response = await api.get<{ unread_count: number }>('/notifications/unread-count');
      return response.data.unread_count;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationIds: number[]) => {
      const response = await api.post('/notifications/mark-read', {
        notification_ids: notificationIds,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post('/notifications/mark-all-read');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: number) => {
      await api.delete(`/notifications/${notificationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}
