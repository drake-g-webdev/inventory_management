import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

// Mock the api module
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import api from '@/lib/api';

const mockUser = {
  id: 1,
  email: 'test@example.com',
  full_name: 'Test User',
  role: 'admin' as const,
  property_id: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: null,
};

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
    });
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('starts unauthenticated', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('login', () => {
    it('sets token and fetches user on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { access_token: 'test-token' },
      });
      vi.mocked(api.get).mockResolvedValueOnce({
        data: mockUser,
      });

      await useAuthStore.getState().login({ email: 'test@example.com', password: 'pass' });

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockUser);
      expect(state.token).toBe('test-token');
    });

    it('clears state on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Invalid credentials'));

      await expect(
        useAuthStore.getState().login({ email: 'bad@example.com', password: 'wrong' })
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears state and localStorage', () => {
      // Set up authenticated state
      useAuthStore.setState({
        user: mockUser,
        token: 'some-token',
        isAuthenticated: true,
      });
      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('fetchUser', () => {
    it('sets user and isAuthenticated on success', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: mockUser });

      await useAuthStore.getState().fetchUser();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('clears state on failure', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('401'));

      await expect(useAuthStore.getState().fetchUser()).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('role helpers', () => {
    it('hasRole returns true for matching role', () => {
      useAuthStore.setState({ user: mockUser });
      expect(useAuthStore.getState().hasRole('admin')).toBe(true);
    });

    it('hasRole returns false for non-matching role', () => {
      useAuthStore.setState({ user: mockUser });
      expect(useAuthStore.getState().hasRole('camp_worker')).toBe(false);
    });

    it('canManageUsers returns true for admin', () => {
      useAuthStore.setState({ user: mockUser });
      expect(useAuthStore.getState().canManageUsers()).toBe(true);
    });

    it('canManageUsers returns false when no user', () => {
      expect(useAuthStore.getState().canManageUsers()).toBe(false);
    });

    it('canCreateOrders returns true for camp_worker', () => {
      useAuthStore.setState({ user: { ...mockUser, role: 'camp_worker' as const } });
      expect(useAuthStore.getState().canCreateOrders()).toBe(true);
    });

    it('canReviewOrders returns true for purchasing_supervisor', () => {
      useAuthStore.setState({ user: { ...mockUser, role: 'purchasing_supervisor' as const } });
      expect(useAuthStore.getState().canReviewOrders()).toBe(true);
    });

    it('canManageReceipts returns true for purchasing_team', () => {
      useAuthStore.setState({ user: { ...mockUser, role: 'purchasing_team' as const } });
      expect(useAuthStore.getState().canManageReceipts()).toBe(true);
    });

    it('canViewAllProperties returns false for camp_worker', () => {
      useAuthStore.setState({ user: { ...mockUser, role: 'camp_worker' as const } });
      expect(useAuthStore.getState().canViewAllProperties()).toBe(false);
    });

    it('canViewAllProperties returns true for admin', () => {
      useAuthStore.setState({ user: mockUser });
      expect(useAuthStore.getState().canViewAllProperties()).toBe(true);
    });

    it('all permission helpers return false when user is null', () => {
      const state = useAuthStore.getState();
      expect(state.canManageUsers()).toBe(false);
      expect(state.canManageProperties()).toBe(false);
      expect(state.canManageInventory()).toBe(false);
      expect(state.canCreateOrders()).toBe(false);
      expect(state.canReviewOrders()).toBe(false);
      expect(state.canManageReceipts()).toBe(false);
      expect(state.canViewAllProperties()).toBe(false);
    });
  });
});
