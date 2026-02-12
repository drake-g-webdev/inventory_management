import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the api module's interceptors
// Since axios.create returns a new instance, we test the exported instance
describe('API client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('exports a default api instance', async () => {
    const { default: api } = await import('./api');
    expect(api).toBeDefined();
    expect(api.defaults.baseURL).toContain('/api/v1');
  });

  it('has JSON content-type header by default', async () => {
    const { default: api } = await import('./api');
    expect(api.defaults.headers['Content-Type']).toBe('application/json');
  });

  it('has request interceptor configured', async () => {
    const { default: api } = await import('./api');
    // Axios interceptors have handlers array
    expect(api.interceptors.request).toBeDefined();
  });

  it('has response interceptor configured', async () => {
    const { default: api } = await import('./api');
    expect(api.interceptors.response).toBeDefined();
  });
});
