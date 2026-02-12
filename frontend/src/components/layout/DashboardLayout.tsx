'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from 'react-hot-toast';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const { isAuthenticated, token, fetchUser, user } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header with menu button */}
        <header className="md:hidden bg-white shadow-sm border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <Menu className="h-6 w-6" />
          </button>
          <span className="font-semibold text-gray-900 truncate">
            {user?.property_name || 'SUKAKPAK'}
          </span>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            <div className="p-4 md:p-8">{children}</div>
          </ErrorBoundary>
        </main>
      </div>
      <Toaster position="top-right" />
    </div>
  );
}
