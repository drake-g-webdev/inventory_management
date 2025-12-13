import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '@/lib/api';
import type { User, LoginCredentials, AuthToken, UserRole } from '@/types';
import {
  canManageUsers,
  canManageProperties,
  canManageInventory,
  canCreateOrders,
  canReviewOrders,
  canManageReceipts,
  canViewAllProperties,
} from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  // Role helpers
  hasRole: (role: UserRole) => boolean;
  canManageUsers: () => boolean;
  canManageProperties: () => boolean;
  canManageInventory: () => boolean;
  canCreateOrders: () => boolean;
  canReviewOrders: () => boolean;
  canManageReceipts: () => boolean;
  canViewAllProperties: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (credentials: LoginCredentials) => {
        console.log('[Auth] Login attempt for:', credentials.email);
        set({ isLoading: true });
        try {
          const formData = new URLSearchParams();
          formData.append('username', credentials.email);
          formData.append('password', credentials.password);

          console.log('[Auth] Sending login request...');
          const response = await api.post<AuthToken>('/auth/login', formData, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });

          const { access_token } = response.data;
          console.log('[Auth] Login successful, token received');
          localStorage.setItem('token', access_token);

          set({ token: access_token, isAuthenticated: true });

          // Fetch user data
          console.log('[Auth] Fetching user data...');
          await get().fetchUser();
          console.log('[Auth] User data fetched successfully');
        } catch (error) {
          console.error('[Auth] Login failed:', error);
          set({ user: null, token: null, isAuthenticated: false });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false });
      },

      fetchUser: async () => {
        console.log('[Auth] Fetching user from /auth/me...');
        try {
          const response = await api.get<User>('/auth/me');
          console.log('[Auth] User fetched:', response.data);
          set({ user: response.data, isAuthenticated: true });
        } catch (error) {
          console.error('[Auth] Failed to fetch user:', error);
          set({ user: null, isAuthenticated: false });
          throw error;
        }
      },

      // Role helpers
      hasRole: (role: UserRole) => {
        const user = get().user;
        return user?.role === role;
      },

      canManageUsers: () => {
        const user = get().user;
        return user ? canManageUsers(user.role) : false;
      },

      canManageProperties: () => {
        const user = get().user;
        return user ? canManageProperties(user.role) : false;
      },

      canManageInventory: () => {
        const user = get().user;
        return user ? canManageInventory(user.role) : false;
      },

      canCreateOrders: () => {
        const user = get().user;
        return user ? canCreateOrders(user.role) : false;
      },

      canReviewOrders: () => {
        const user = get().user;
        return user ? canReviewOrders(user.role) : false;
      },

      canManageReceipts: () => {
        const user = get().user;
        return user ? canManageReceipts(user.role) : false;
      },

      canViewAllProperties: () => {
        const user = get().user;
        return user ? canViewAllProperties(user.role) : false;
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
);
