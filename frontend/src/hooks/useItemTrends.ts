import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ItemTrendsData } from '@/types';

export function useItemTrends(itemId?: number) {
  return useQuery({
    queryKey: ['item-trends', itemId],
    queryFn: async () => {
      const response = await api.get<ItemTrendsData>(`/admin/item-trends/${itemId}`);
      return response.data;
    },
    enabled: !!itemId,
    staleTime: 60 * 1000,
  });
}
