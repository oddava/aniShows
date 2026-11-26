import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AnnouncementBanner, { DISMISSED_KEY } from '../AnnouncementBanner';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../api/httpClient', () => ({ default: { get } }));

const renderBanner = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AnnouncementBanner />
    </QueryClientProvider>,
);

beforeEach(() => {
    window.localStorage.clear();
    get.mockReset();
    get.mockResolvedValue({
        data: [{ id: 7, title: 'Maintenance on Sunday', body: 'Back by noon.', level: 'warning', link_url: '/schedule', link_label: 'Details' }],
    });
});

describe('AnnouncementBanner', () => {
    it('shows live announcements with their link', async () => {
        renderBanner();
        expect(await screen.findByText('Maintenance on Sunday')).toBeInTheDocument();
        expect(get).toHaveBeenCalledWith('/announcements/active/', expect.anything());
        expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/schedule');
    });

    it('remembers a dismissal on this device', async () => {
        const user = userEvent.setup();
        const { unmount } = renderBanner();
        await user.click(await screen.findByRole('button', { name: 'Dismiss announcement' }));

        expect(screen.queryByText('Maintenance on Sunday')).not.toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem(DISMISSED_KEY))).toEqual(['7']);

        unmount();
        renderBanner();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(screen.queryByText('Maintenance on Sunday')).not.toBeInTheDocument();
    });

    it('shows nothing when the request fails', async () => {
        get.mockRejectedValue(new Error('offline'));
        const { container } = renderBanner();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(container).toBeEmptyDOMElement();
    });

    it('never links to a script URL', async () => {
        get.mockResolvedValue({ data: [{ id: 8, title: 'Hi', level: 'info', link_url: 'javascript:alert(1)' }] });
        renderBanner();
        expect(await screen.findByText('Hi')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
