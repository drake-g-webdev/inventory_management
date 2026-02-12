'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';

export default function Home() {
  const router = useRouter();
  const { token, user } = useAuthStore();

  useEffect(() => {
    if (token) {
      // Redirect based on role
      if (user?.role === 'camp_worker') {
        router.push('/inventory');
      } else if (user?.role === 'purchasing_team') {
        router.push('/orders/all');
      } else {
        router.push('/dashboard');
      }
    } else {
      router.push('/auth/login');
    }
  }, [token, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
  );
}
