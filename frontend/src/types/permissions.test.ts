import { describe, it, expect } from 'vitest';
import {
  canManageUsers,
  canManageProperties,
  canManageInventory,
  canCreateOrders,
  canReviewOrders,
  canManageReceipts,
  canViewAllProperties,
} from './index';
import type { UserRole } from './index';

const roles: UserRole[] = ['admin', 'camp_worker', 'purchasing_supervisor', 'purchasing_team'];

describe('canManageUsers', () => {
  it('returns true for admin', () => {
    expect(canManageUsers('admin')).toBe(true);
  });

  it('returns false for all non-admin roles', () => {
    expect(canManageUsers('camp_worker')).toBe(false);
    expect(canManageUsers('purchasing_supervisor')).toBe(false);
    expect(canManageUsers('purchasing_team')).toBe(false);
  });
});

describe('canManageProperties', () => {
  it('returns true for admin', () => {
    expect(canManageProperties('admin')).toBe(true);
  });

  it('returns false for all non-admin roles', () => {
    expect(canManageProperties('camp_worker')).toBe(false);
    expect(canManageProperties('purchasing_supervisor')).toBe(false);
    expect(canManageProperties('purchasing_team')).toBe(false);
  });
});

describe('canManageInventory', () => {
  it('returns true for camp_worker', () => {
    expect(canManageInventory('camp_worker')).toBe(true);
  });

  it('returns true for admin', () => {
    expect(canManageInventory('admin')).toBe(true);
  });

  it('returns false for supervisor and purchasing_team', () => {
    expect(canManageInventory('purchasing_supervisor')).toBe(false);
    expect(canManageInventory('purchasing_team')).toBe(false);
  });
});

describe('canCreateOrders', () => {
  it('returns true for camp_worker', () => {
    expect(canCreateOrders('camp_worker')).toBe(true);
  });

  it('returns false for all other roles', () => {
    expect(canCreateOrders('admin')).toBe(false);
    expect(canCreateOrders('purchasing_supervisor')).toBe(false);
    expect(canCreateOrders('purchasing_team')).toBe(false);
  });
});

describe('canReviewOrders', () => {
  it('returns true for purchasing_supervisor', () => {
    expect(canReviewOrders('purchasing_supervisor')).toBe(true);
  });

  it('returns false for all other roles', () => {
    expect(canReviewOrders('admin')).toBe(false);
    expect(canReviewOrders('camp_worker')).toBe(false);
    expect(canReviewOrders('purchasing_team')).toBe(false);
  });
});

describe('canManageReceipts', () => {
  it('returns true for purchasing_team', () => {
    expect(canManageReceipts('purchasing_team')).toBe(true);
  });

  it('returns true for purchasing_supervisor', () => {
    expect(canManageReceipts('purchasing_supervisor')).toBe(true);
  });

  it('returns false for admin and camp_worker', () => {
    expect(canManageReceipts('admin')).toBe(false);
    expect(canManageReceipts('camp_worker')).toBe(false);
  });
});

describe('canViewAllProperties', () => {
  it('returns false for camp_worker', () => {
    expect(canViewAllProperties('camp_worker')).toBe(false);
  });

  it('returns true for all other roles', () => {
    expect(canViewAllProperties('admin')).toBe(true);
    expect(canViewAllProperties('purchasing_supervisor')).toBe(true);
    expect(canViewAllProperties('purchasing_team')).toBe(true);
  });
});
