import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate, formatDateTime, getStatusColor } from './utils';

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('handles tailwind conflicts', () => {
    expect(cn('px-4', 'px-6')).toBe('px-6');
  });
});

describe('formatCurrency', () => {
  it('formats numbers as USD currency', () => {
    expect(formatCurrency(10.99)).toBe('$10.99');
    expect(formatCurrency(1000)).toBe('$1,000.00');
  });

  it('handles null and undefined', () => {
    expect(formatCurrency(null)).toBe('-');
    expect(formatCurrency(undefined)).toBe('-');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('handles NaN', () => {
    expect(formatCurrency(NaN)).toBe('-');
  });

  it('handles negative numbers', () => {
    expect(formatCurrency(-50)).toBe('-$50.00');
  });
});

describe('formatDate', () => {
  it('formats date strings', () => {
    const result = formatDate('2024-01-15T12:00:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('handles null and undefined', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
  });
});

describe('formatDateTime', () => {
  it('formats datetime strings with time', () => {
    const result = formatDateTime('2024-01-15T14:30:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('handles null', () => {
    expect(formatDateTime(null)).toBe('-');
  });

  it('handles undefined', () => {
    expect(formatDateTime(undefined)).toBe('-');
  });

  it('handles empty string', () => {
    expect(formatDateTime('')).toBe('-');
  });
});

describe('getStatusColor', () => {
  it('returns correct colors for each status', () => {
    expect(getStatusColor('draft')).toContain('gray');
    expect(getStatusColor('pending')).toContain('yellow');
    expect(getStatusColor('approved')).toContain('blue');
    expect(getStatusColor('received')).toContain('green');
    expect(getStatusColor('cancelled')).toContain('red');
  });

  it('returns purple for ordered status', () => {
    expect(getStatusColor('ordered')).toContain('purple');
  });

  it('returns default color for unknown status', () => {
    expect(getStatusColor('unknown')).toContain('gray');
  });
});
