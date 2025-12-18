'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Truck,
  ClipboardList,
  LogOut,
  Users,
  Building2,
  Receipt,
  ClipboardCheck,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { ROLE_LABELS } from '@/types';

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  roles: ('admin' | 'camp_worker' | 'purchasing_supervisor' | 'purchasing_team')[];
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'purchasing_supervisor'] },
  // Admin only
  { name: 'Users', href: '/admin/users', icon: Users, roles: ['admin'] },
  { name: 'Properties', href: '/admin/properties', icon: Building2, roles: ['admin'] },
  { name: 'Receipts', href: '/admin/receipts', icon: Receipt, roles: ['admin'] },
  { name: 'Seed Inventory', href: '/admin/seed-inventory', icon: Package, roles: ['admin'] },
  // Camp Worker
  { name: 'Inventory', href: '/inventory', icon: Package, roles: ['camp_worker'] },
  { name: 'Orders', href: '/orders', icon: ClipboardList, roles: ['camp_worker'] },
  { name: 'Receive Orders', href: '/orders/receive', icon: CheckCircle, roles: ['camp_worker'] },
  // Purchasing Support
  { name: 'Camp Inventory', href: '/inventory/view', icon: Package, roles: ['purchasing_supervisor'] },
  { name: 'Review Orders', href: '/orders/review', icon: ClipboardCheck, roles: ['purchasing_supervisor'] },
  { name: 'All Orders', href: '/orders/all', icon: ClipboardList, roles: ['purchasing_supervisor', 'purchasing_team'] },
  // Purchasing Supervisor only
  { name: 'Receipts', href: '/receipts', icon: Receipt, roles: ['purchasing_supervisor'] },
  // Shared
  { name: 'Suppliers', href: '/suppliers', icon: Truck, roles: ['purchasing_supervisor', 'admin'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, user } = useAuthStore();

  const filteredNavigation = navigation.filter(
    (item) => user && item.roles.includes(user.role)
  );

  return (
    <div className="flex flex-col h-full w-64 bg-gray-900">
      {/* Logo */}
      <div className="flex items-center h-16 px-6 bg-gray-800">
        <span className="text-xl font-bold text-white">SUKAKPAK Purchasing</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {filteredNavigation.map((item) => {
          // For exact matches or sub-routes, but exclude parent routes that are prefixes of other nav items
          const isExactMatch = pathname === item.href;
          const isSubRoute = pathname.startsWith(item.href + '/');
          // Check if any other nav item has this item's href as a prefix (e.g., /orders vs /orders/receive)
          const hasMoreSpecificMatch = filteredNavigation.some(
            other => other.href !== item.href &&
                     other.href.startsWith(item.href + '/') &&
                     (pathname === other.href || pathname.startsWith(other.href + '/'))
          );
          const isActive = isExactMatch || (isSubRoute && !hasMoreSpecificMatch);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5 mr-3" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="px-4 py-4 border-t border-gray-800">
        <div className="flex items-center mb-2">
          <div className="flex-shrink-0">
            <div className="h-8 w-8 rounded-full bg-primary-600 flex items-center justify-center">
              <span className="text-sm font-medium text-white">
                {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </span>
            </div>
          </div>
          <div className="ml-3 overflow-hidden">
            <p className="text-sm font-medium text-white truncate">
              {user?.full_name || user?.email}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {user?.role ? ROLE_LABELS[user.role] : ''}
            </p>
          </div>
        </div>
        {user?.property_id && (
          <p className="text-xs text-gray-500 mb-3 px-1">
            {user.property_name || `Property #${user.property_id}`}
          </p>
        )}
        <button
          onClick={logout}
          className="flex items-center w-full px-4 py-2 text-sm font-medium text-gray-300 rounded-lg hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="h-5 w-5 mr-3" />
          Sign out
        </button>
      </div>
    </div>
  );
}
