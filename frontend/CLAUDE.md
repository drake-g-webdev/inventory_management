# Frontend Guard Rails

## STOP - Before ANY commit:
- Run `npx tsc --noEmit` to verify no TypeScript errors
- New types go in `src/types/index.ts`
- New hooks follow React Query pattern in `src/hooks/`

## Categories System (Easy to Break)
- Hardcoded: `src/lib/constants.ts` (CATEGORIES, UNITS)
- Custom: `useCustomCategories()` hook from `useMasterProducts.ts`
- BOTH master-products page AND inventory page merge custom + hardcoded
- If you change categories in one place, check the other

## Key Files
- API client: `src/lib/api.ts` (Axios + JWT interceptor, base URL from NEXT_PUBLIC_API_URL)
- Auth state: `src/stores/authStore.ts` (Zustand with persist)
- Sidebar nav: `src/components/layout/Sidebar.tsx` (role-based menu items)
- Route protection: `src/components/auth/AuthGuard.tsx` and `RoleGuard.tsx`

## Adding a Page
1. Create `src/app/<route>/page.tsx`
2. Wrap with AuthGuard (+ RoleGuard if admin-only)
3. Use DashboardLayout
4. Add nav link in Sidebar.tsx
