import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdultContentGate, { ADULT_GATE_CODE, isAdultGateError } from '../AdultContentGate';

const auth = { isAuthenticated: false };
const preference = { toggle: vi.fn(), isUpdating: false };

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../hooks/useAdultContentPreference', () => ({ default: () => preference }));

const LoginProbe = () => {
    const location = useLocation();
    return <p data-testid="login-from">{location.state?.from}</p>;
};

const renderGate = (onEnabled = vi.fn()) => {
    render(
        <HelmetProvider>
            <MemoryRouter initialEntries={['/anime/explicit-show?tab=staff']}>
                <Routes>
                    <Route path="/anime/:slug" element={<AdultContentGate onEnabled={onEnabled} />} />
                    <Route path="/login" element={<LoginProbe />} />
                </Routes>
            </MemoryRouter>
        </HelmetProvider>,
    );
    return onEnabled;
};

describe('isAdultGateError', () => {
    it('matches only the API gate answer', () => {
        expect(isAdultGateError({ response: { status: 403, data: { code: ADULT_GATE_CODE } } })).toBe(true);
        expect(isAdultGateError({ response: { status: 403, data: { code: 'permission_denied' } } })).toBe(false);
        expect(isAdultGateError({ response: { status: 404, data: { code: ADULT_GATE_CODE } } })).toBe(false);
        expect(isAdultGateError(undefined)).toBe(false);
    });
});

describe('AdultContentGate (D-2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.isAuthenticated = false;
        preference.isUpdating = false;
    });

    it('sends a guest to sign in and back to this page', () => {
        renderGate();

        expect(screen.getByRole('heading', { name: '18+ title' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show adult content' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
        expect(screen.getByTestId('login-from')).toHaveTextContent('/anime/explicit-show?tab=staff');
    });

    it('lets a member opt in, then reloads the page', async () => {
        auth.isAuthenticated = true;
        preference.toggle.mockResolvedValue(undefined);
        const onEnabled = renderGate();

        fireEvent.click(screen.getByRole('button', { name: 'Show adult content' }));

        await waitFor(() => expect(onEnabled).toHaveBeenCalledTimes(1));
        expect(preference.toggle).toHaveBeenCalledTimes(1);
    });

    it('says so when the setting could not be saved', async () => {
        auth.isAuthenticated = true;
        preference.toggle.mockRejectedValue(new Error('offline'));
        const onEnabled = renderGate();

        fireEvent.click(screen.getByRole('button', { name: 'Show adult content' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update your setting');
        expect(onEnabled).not.toHaveBeenCalled();
    });
});
