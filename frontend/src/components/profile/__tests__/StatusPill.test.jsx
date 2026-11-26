import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StatusPill from '../StatusPill';
import { profileKeys } from '../../../api/queries/profile';

const updateProfile = vi.fn();
const notify = vi.fn();
vi.mock('../../../api/client', () => ({ authApi: { updateProfile: (...a) => updateProfile(...a) } }));
vi.mock('../../ui/toast', () => ({ notify: (...a) => notify(...a) }));

const OWNER = { username: 'oddava', status_emoji: '🎧', status_text: 'chilling' };

function setup({ editable = true, profile = OWNER } = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(profileKeys.own, { ...profile });
    queryClient.setQueryData(profileKeys.byUsername(profile.username), { ...profile });
    const cached = () => queryClient.getQueryData(profileKeys.own);
    // Re-renders from the cache, as ProfileHeader does from the profile query.
    function Harness() {
        const data = cached();
        return (
            <StatusPill
                emoji={data?.status_emoji || ''}
                text={data?.status_text || ''}
                editable={editable}
                username={profile.username}
            />
        );
    }
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <Harness />
        </QueryClientProvider>,
    );
    queryClient.getQueryCache().subscribe(() => utils.rerender(
        <QueryClientProvider client={queryClient}>
            <Harness />
        </QueryClientProvider>,
    ));
    return { queryClient, cached, user: userEvent.setup() };
}

describe('StatusPill', () => {
    beforeEach(() => {
        updateProfile.mockReset();
        notify.mockReset();
    });

    it('is a plain pill for visitors', () => {
        setup({ editable: false });

        expect(screen.getByText('chilling')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows nothing to visitors when there is no status', () => {
        const { container } = render(
            <QueryClientProvider client={new QueryClient()}>
                <StatusPill editable={false} username="x" />
            </QueryClientProvider>,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('lets the owner open an editor from the pill, named after what it shows', async () => {
        const { user } = setup();

        const pill = screen.getByRole('button', { name: /^🎧 chilling, edit status|^chilling, edit status/ });
        expect(pill).toHaveAttribute('aria-expanded', 'false');
        await user.click(pill);

        const dialog = screen.getByRole('dialog', { name: 'Your status' });
        expect(within(dialog).getByRole('textbox', { name: 'Status text' })).toHaveValue('chilling');
        expect(within(dialog).getByRole('textbox', { name: 'Status text' })).toHaveFocus();
        expect(within(dialog).getByRole('button', { name: '🎧' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(dialog).getByText('8/80')).toBeInTheDocument();
    });

    it('saves optimistically and says so', async () => {
        let resolve;
        updateProfile.mockReturnValue(new Promise((r) => { resolve = r; }));
        const { user, cached } = setup();

        await user.click(screen.getByRole('button', { name: /edit status/ }));
        const input = screen.getByRole('textbox', { name: 'Status text' });
        await user.clear(input);
        await user.type(input, '  binging   Frieren ');
        await user.click(screen.getByRole('button', { name: '🍿' }));
        await user.click(screen.getByRole('button', { name: 'Save' }));

        // Shown before the server answers.
        expect(cached()).toMatchObject({ status_emoji: '🍿', status_text: 'binging Frieren' });
        expect(updateProfile).toHaveBeenCalledWith({ status_emoji: '🍿', status_text: 'binging Frieren' });

        resolve({ data: { status_emoji: '🍿', status_text: 'binging Frieren' } });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(notify).toHaveBeenCalledWith('Status updated', { id: 'profile-status' });
        expect(screen.getByRole('button', { name: /binging Frieren, edit status/ })).toHaveFocus();
    });

    it('clears the status', async () => {
        updateProfile.mockResolvedValue({ data: { status_emoji: '', status_text: '' } });
        const { user, cached } = setup();

        await user.click(screen.getByRole('button', { name: /edit status/ }));
        await user.click(screen.getByRole('button', { name: 'Clear status' }));

        expect(updateProfile).toHaveBeenCalledWith({ status_emoji: '', status_text: '' });
        await waitFor(() => expect(notify).toHaveBeenCalledWith('Status cleared', { id: 'profile-status' }));
        expect(cached()).toMatchObject({ status_emoji: '', status_text: '' });
        // The owner can set one again from an empty pill.
        expect(screen.getByRole('button', { name: /set a status/i })).toBeInTheDocument();
    });

    it('limits the text to 80 characters', async () => {
        const { user } = setup();

        await user.click(screen.getByRole('button', { name: /edit status/ }));
        const input = screen.getByRole('textbox', { name: 'Status text' });
        expect(input).toHaveAttribute('maxLength', '80');
        await user.clear(input);
        await user.type(input, 'x'.repeat(85));
        expect(input).toHaveValue('x'.repeat(80));
        expect(screen.getByText('80/80')).toBeInTheDocument();
    });

    it('puts the old status back and shows the server error when saving fails', async () => {
        updateProfile.mockRejectedValue({
            response: { status: 400, data: { detail: 'Invalid input.', errors: { status_emoji: ['Pick one emoji.'] } } },
        });
        const { user, cached } = setup();

        await user.click(screen.getByRole('button', { name: /edit status/ }));
        const input = screen.getByRole('textbox', { name: 'Status text' });
        await user.clear(input);
        await user.type(input, 'new words');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Pick one emoji.');
        expect(cached()).toMatchObject({ status_emoji: '🎧', status_text: 'chilling' });
        // The draft stays, ready to fix and retry.
        expect(input).toHaveValue('new words');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(notify).not.toHaveBeenCalled();
    });

    it('closes on Escape without saving and returns focus to the pill', async () => {
        const { user } = setup();

        const pill = screen.getByRole('button', { name: /edit status/ });
        await user.click(pill);
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(pill).toHaveFocus();
        expect(updateProfile).not.toHaveBeenCalled();
    });
});
