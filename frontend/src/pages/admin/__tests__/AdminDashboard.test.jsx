import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminDashboard from '../AdminDashboard';

const { getMock, logError } = vi.hoisted(() => ({ getMock: vi.fn(), logError: vi.fn() }));

vi.mock('../../../api/client', () => ({ default: { get: (...args) => getMock(...args) } }));
vi.mock('../../../utils/logger', () => ({ default: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
// jsdom has no layout (ResizeObserver), so the charts render as plain wrappers.
vi.mock('recharts', () => {
    const Passthrough = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        AreaChart: Passthrough,
        Area: Passthrough,
        XAxis: Passthrough,
        YAxis: Passthrough,
        CartesianGrid: Passthrough,
        Tooltip: Passthrough,
        ResponsiveContainer: Passthrough,
        BarChart: Passthrough,
        Bar: Passthrough,
        Cell: Passthrough,
    };
});

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <AdminDashboard />
            </MemoryRouter>
        </QueryClientProvider>,
    );
};

describe('AdminDashboard', () => {
    beforeEach(() => {
        getMock.mockReset();
        logError.mockReset();
    });

    it('shows the loading state until the stats arrive', async () => {
        getMock.mockResolvedValue({
            data: { statistics: { users: { total: 1234, new_7d: 5, verified: 1000 }, content: {} } },
        });
        renderPage();

        expect(screen.getByText('Loading dashboard telemetry...')).toBeInTheDocument();
        expect(await screen.findByText('Total Users')).toBeInTheDocument();
        expect(screen.queryByText('Loading dashboard telemetry...')).toBeNull();
        expect(getMock).toHaveBeenCalledTimes(1);
        expect(getMock.mock.calls[0][0]).toBe('/admin/dashboard/');
    });

    it('shows the API error instead of spinning forever', async () => {
        getMock.mockRejectedValue({ response: { status: 403, data: { detail: 'Admins only.' } } });
        renderPage();

        expect(await screen.findByText('Access Denied')).toBeInTheDocument();
        expect(screen.getByText('Admins only.')).toBeInTheDocument();
        expect(screen.queryByText('Loading dashboard telemetry...')).toBeNull();
        expect(logError).toHaveBeenCalledTimes(1);
        expect(getMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to a generic message without an API detail', async () => {
        getMock.mockRejectedValue(new Error('Network Error'));
        renderPage();

        expect(await screen.findByText('Failed to load dashboard data')).toBeInTheDocument();
    });
});
