import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { importJobKeys, importJobQueries, normalizeJobsResponse } from '../importJobs';

const api = vi.hoisted(() => ({ getImportJobs: vi.fn(), getImportJobStatus: vi.fn() }));
vi.mock('../../client', () => ({ importExportApi: api }));

beforeEach(() => Object.values(api).forEach((mock) => mock.mockReset()));

describe('importJobKeys', () => {
    it('scopes jobs by user', () => {
        expect(importJobKeys.forUser(3)).toEqual(['importJobs', 3]);
        expect(importJobKeys.list(3)).toEqual(['importJobs', 3, 'list']);
        expect(importJobKeys.detail(3, 'j1')).toEqual(['importJobs', 3, 'detail', 'j1']);
        expect(importJobKeys.list(undefined)).toEqual(['importJobs', 'anonymous', 'list']);
    });

    it('invalidating a user covers the list and polled jobs', async () => {
        const client = new QueryClient();
        client.setQueryData(importJobKeys.list(3), []);
        client.setQueryData(importJobKeys.detail(3, 'j1'), {});
        client.setQueryData(importJobKeys.list(4), []);
        await client.invalidateQueries({ queryKey: importJobKeys.forUser(3) });
        expect(client.getQueryState(importJobKeys.list(3)).isInvalidated).toBe(true);
        expect(client.getQueryState(importJobKeys.detail(3, 'j1')).isInvalidated).toBe(true);
        expect(client.getQueryState(importJobKeys.list(4)).isInvalidated).toBe(false);
    });
});

describe('importJobQueries', () => {
    it('normalizes both response shapes', async () => {
        expect(normalizeJobsResponse([{ id: 1 }])).toEqual([{ id: 1 }]);
        expect(normalizeJobsResponse({ results: [{ id: 2 }] })).toEqual([{ id: 2 }]);
        expect(normalizeJobsResponse(null)).toEqual([]);

        api.getImportJobs.mockResolvedValue({ data: { results: [{ id: 2 }] } });
        await expect(importJobQueries.list(3).queryFn()).resolves.toEqual([{ id: 2 }]);
    });

    it('polls a job every 2s only while it is active and the last read succeeded', async () => {
        api.getImportJobStatus.mockResolvedValue({ data: { id: 'j1', status: 'pending' } });
        const options = importJobQueries.status(3, 'j1');
        await expect(options.queryFn()).resolves.toEqual({ id: 'j1', status: 'pending' });
        expect(api.getImportJobStatus).toHaveBeenCalledWith('j1');

        const interval = (status, data) => options.refetchInterval({ state: { status, data } });
        expect(interval('success', { status: 'pending' })).toBe(2000);
        expect(interval('success', { status: 'processing' })).toBe(2000);
        expect(interval('success', { status: 'completed' })).toBe(false);
        expect(interval('error', { status: 'processing' })).toBe(false);
        expect(interval('pending', undefined)).toBe(false);
    });
});
