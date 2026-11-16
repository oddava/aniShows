import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotificationsTab from '../../settings/NotificationsTab';
import useNotificationPreferences from '../../settings/useNotificationPreferences';

const api = vi.hoisted(() => ({
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    getPushConfig: vi.fn(),
    getSubscriptions: vi.fn(),
    deleteSubscription: vi.fn(),
}));
const push = vi.hoisted(() => ({
    support: vi.fn(),
    getDeviceState: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
}));

vi.mock('../../../api/modules/notifications', () => ({ notificationApi: api }));
vi.mock('../pushClient', () => push);
vi.mock('../../../utils/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const SCHEMA = {
    channels: [
        { key: 'in_app', label: 'In-app' },
        { key: 'push', label: 'Push' },
        { key: 'email', label: 'Email' },
    ],
    categories: [
        { key: 'episodes', label: 'Episodes', description: 'New episodes of shows you’re watching', channels: ['in_app', 'push', 'email'], locked: [] },
        { key: 'replies', label: 'Replies', description: 'Replies and mentions', channels: ['in_app', 'push'], locked: [] },
        { key: 'likes', label: 'Likes', description: 'Likes on your reviews and posts', channels: ['in_app', 'push'], locked: [] },
        { key: 'follows', label: 'Follows', description: 'New followers', channels: ['in_app', 'push'], locked: [] },
        { key: 'account', label: 'Account', description: 'Badges and announcements', channels: ['in_app', 'push'], locked: ['in_app'] },
    ],
};
const PREFERENCES = {
    episodes: { in_app: true, push: true, email: false },
    replies: { in_app: true, push: true },
    likes: { in_app: true, push: false },
    follows: { in_app: true, push: true },
    account: { in_app: true, push: true },
};

function Harness() {
    const queryClient = useQueryClient();
    const notifications = useNotificationPreferences({ user: { id: 7 }, queryClient });
    return <NotificationsTab notifications={notifications} />;
}

const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <Harness />
        </QueryClientProvider>
    );
    return client;
};

const deviceWithPush = (subscribed, serverDevices = subscribed ? [{ id: 1, device_info: { label: 'This one' } }] : []) => {
    push.getDeviceState.mockResolvedValue({ support: 'granted', subscribed, endpoint: subscribed ? 'e' : null, id: subscribed ? 1 : null });
    api.getSubscriptions.mockResolvedValue({ data: serverDevices });
};

beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    Object.values(push).forEach((mock) => mock.mockReset());
    push.support.mockReturnValue('granted');
    api.getPreferences.mockResolvedValue({ data: { preferences: PREFERENCES, schema: SCHEMA } });
    api.getPushConfig.mockResolvedValue({ data: { enabled: true, public_key: 'BAEC' } });
    deviceWithPush(true);
});

describe('NotificationsTab (preferences matrix)', () => {
    it('treats this device as off when the server no longer has its row', async () => {
        deviceWithPush(true, []);
        renderTab();
        const pushSwitch = await screen.findByRole('switch', { name: 'Push for Replies' });
        await waitFor(() => expect(pushSwitch).toBeDisabled());
        expect(pushSwitch).toHaveAccessibleDescription('Enable push on this device first');
    });

    it('lets push preferences change when another device has push', async () => {
        deviceWithPush(false, [{ id: 5, device_info: { label: 'Chrome on Android' } }]);
        renderTab();
        const pushSwitch = await screen.findByRole('switch', { name: 'Push for Replies' });
        await waitFor(() => expect(pushSwitch).toBeEnabled());
    });

    it('disables push and email while in-app is off for that category', async () => {
        api.getPreferences.mockResolvedValue({
            data: { preferences: { ...PREFERENCES, episodes: { in_app: false, push: true, email: true } }, schema: SCHEMA },
        });
        renderTab();
        const pushSwitch = await screen.findByRole('switch', { name: 'Push for Episodes' });
        await waitFor(() => expect(pushSwitch).toBeDisabled());
        expect(pushSwitch).toHaveAccessibleDescription('Turn on In-app first');
        expect(screen.getByRole('switch', { name: 'Email for Episodes' })).toBeDisabled();
        expect(screen.getByRole('switch', { name: 'In-app for Episodes' })).toBeEnabled();
    });

    it('renders a switch for each channel a category offers', async () => {
        renderTab();

        await screen.findByRole('switch', { name: 'In-app for Episodes' });
        expect(screen.getAllByRole('switch')).toHaveLength(11);
        expect(screen.getByRole('switch', { name: 'Email for Episodes' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('switch', { name: 'Push for Likes' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByRole('switch', { name: 'Email for Replies' })).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Replies' })).toBeInTheDocument();
    });

    it('disables locked switches', async () => {
        renderTab();

        const locked = await screen.findByRole('switch', { name: 'In-app for Account' });
        expect(locked).toBeDisabled();
        expect(locked).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: 'Push for Account' })).toBeEnabled();
    });

    it('disables the Push column until this device has push on', async () => {
        deviceWithPush(false);
        renderTab();

        const pushSwitch = await screen.findByRole('switch', { name: 'Push for Replies' });
        await waitFor(() => expect(screen.getByText('Enable push on this device first')).toBeInTheDocument());
        expect(pushSwitch).toBeDisabled();
        expect(pushSwitch).toHaveAccessibleDescription('Enable push on this device first');
        expect(screen.getByRole('switch', { name: 'In-app for Replies' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Turn on for this device' })).toBeInTheDocument();
    });

    it('hides the Push column when the server has no push', async () => {
        api.getPushConfig.mockResolvedValue({ data: { enabled: false, public_key: '' } });
        renderTab();

        await screen.findByRole('switch', { name: 'In-app for Episodes' });
        await waitFor(() => expect(screen.queryByRole('switch', { name: 'Push for Replies' })).not.toBeInTheDocument());
        expect(screen.getByText(/aren’t available right now/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Turn on for this device' })).not.toBeInTheDocument();
    });

    it('shows a toggle at once and saves only that key', async () => {
        let resolveSave;
        api.updatePreferences.mockReturnValue(new Promise((resolve) => {
            resolveSave = resolve;
        }));
        renderTab();

        const replies = await screen.findByRole('switch', { name: 'Push for Replies' });
        await waitFor(() => expect(replies).toBeEnabled());
        fireEvent.click(replies);

        expect(replies).toHaveAttribute('aria-checked', 'false');
        expect(api.updatePreferences).toHaveBeenCalledWith({ replies: { push: false } });

        await act(async () => {
            resolveSave({
                data: { preferences: { ...PREFERENCES, replies: { in_app: true, push: false } }, schema: SCHEMA },
            });
        });
        expect(replies).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Saved.').closest('[role="status"]')).toBeInTheDocument();
    });

    it('keeps both toggles when two saves answer out of order', async () => {
        const resolvers = {};
        api.updatePreferences.mockImplementation((body) => new Promise((resolve) => {
            resolvers[Object.keys(body)[0]] = resolve;
        }));
        renderTab();

        const replies = await screen.findByRole('switch', { name: 'Push for Replies' });
        const likes = screen.getByRole('switch', { name: 'Push for Likes' });
        await waitFor(() => expect(replies).toBeEnabled());
        fireEvent.click(replies); // replies.push -> false
        fireEvent.click(likes); // likes.push -> true

        // The likes save answers first with a matrix that already has both changes,
        // then the replies save answers with an older snapshot (likes.push still false).
        await act(async () => {
            resolvers.likes({ data: { preferences: { ...PREFERENCES, replies: { in_app: true, push: false }, likes: { in_app: true, push: true } }, schema: SCHEMA } });
        });
        await act(async () => {
            resolvers.replies({ data: { preferences: { ...PREFERENCES, replies: { in_app: true, push: false } }, schema: SCHEMA } });
        });

        expect(replies).toHaveAttribute('aria-checked', 'false');
        expect(likes).toHaveAttribute('aria-checked', 'true');
    });

    it('rolls back a failed toggle and says so in the live region', async () => {
        api.updatePreferences.mockRejectedValue(new Error('500'));
        renderTab();

        const episodes = await screen.findByRole('switch', { name: 'In-app for Episodes' });
        fireEvent.click(episodes);
        expect(episodes).toHaveAttribute('aria-checked', 'false');

        await waitFor(() => expect(episodes).toHaveAttribute('aria-checked', 'true'));
        const statuses = screen.getAllByRole('status');
        const matrixStatus = statuses.find((node) => /couldn’t save/i.test(node.textContent));
        expect(matrixStatus).toBeTruthy();
        expect(matrixStatus.textContent).not.toMatch(/[✓!]/);
    });

    it('lists other devices and removes one', async () => {
        api.getSubscriptions.mockResolvedValue({
            data: [
                { id: 1, device_type: 'browser', device_info: { label: 'Chrome on Android' } },
                { id: 2, device_type: 'browser', device_info: { label: 'Firefox on Windows' } },
            ],
        });
        api.deleteSubscription.mockResolvedValue({});
        renderTab();

        const remove = await screen.findByRole('button', { name: 'Remove Firefox on Windows' });
        // Device 1 is this one.
        expect(screen.queryByRole('button', { name: 'Remove Chrome on Android' })).not.toBeInTheDocument();
        fireEvent.click(remove);

        await waitFor(() => expect(api.deleteSubscription).toHaveBeenCalledWith(2));
        await waitFor(() => expect(screen.queryByText('Firefox on Windows')).not.toBeInTheDocument());
    });

    it('explains iPhone tabs instead of offering a button', async () => {
        push.support.mockReturnValue('ios-needs-install');
        push.getDeviceState.mockResolvedValue({ support: 'ios-needs-install', subscribed: false, endpoint: null, id: null });
        renderTab();

        const card = (await screen.findByText(/Add aniShows to your Home Screen to get push notifications/)).closest('div');
        expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    });
});
