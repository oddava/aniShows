import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VerificationBanner from '../VerificationBanner';

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { email: 'me@example.com', email_verified: false } }),
}));
vi.mock('../../api/client', () => ({ authApi: { resendVerification: vi.fn() } }));

describe('VerificationBanner', () => {
    it('deep-links to the account settings tab', () => {
        render(<MemoryRouter><VerificationBanner /></MemoryRouter>);

        expect(screen.getByRole('link', { name: 'Change email' })).toHaveAttribute('href', '/settings?tab=account');
    });
});
