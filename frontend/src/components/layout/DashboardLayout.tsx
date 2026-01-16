'use client';

import { useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'react-hot-toast';
import Sidebar from './Sidebar';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
// import NotificationBell from '@/components/notifications/NotificationBell';
import { useAuthStore } from '@/stores/authStore';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const { isAuthenticated, token, fetchUser, user } = useAuthStore();

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
      return;
    }

    if (!isAuthenticated) {
      fetchUser().catch(() => {
        router.push('/auth/login');
      });
    }
  }, [token, isAuthenticated, fetchUser, router]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <div className="p-8">{children}</div>
          </ErrorBoundary>
        </main>
      </div>
      <Toaster position="top-right" />
    </div>
  );
}
