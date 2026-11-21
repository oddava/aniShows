import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import useSignOut, { SIGNED_OUT_MESSAGE } from '../useSignOut';

const calls = [];
const logoutMock = vi.fn(async () => {
    calls.push('logout');
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ logout: logoutMock }),
}));
vi.mock('../../ui/toast', () => ({
    notify: vi.fn((message) => {
        calls.push(`toast:${message}`);
    }),
}));

let signOut;
function Probe() {
    signOut = useSignOut();
    return <div data-testid="where">{useLocation().pathname}</div>;
}

describe('useSignOut', () => {
    beforeEach(() => {
        calls.length = 0;
        vi.clearAllMocks();
    });

    it('ends the session first, then lands on home with one "Signed out." toast', async () => {
        render(
            <MemoryRouter initialEntries={['/u/someone?tab=lists']}>
                <Routes>
                    <Route path="*" element={<Probe />} />
                </Routes>
            </MemoryRouter>,
        );

        await act(() => signOut());

        expect(SIGNED_OUT_MESSAGE).toBe('Signed out.');
        expect(calls).toEqual(['logout', 'toast:Signed out.']);
        expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    });
});
