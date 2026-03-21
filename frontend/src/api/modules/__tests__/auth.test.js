import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../httpClient';
import { authApi } from '../auth';

vi.mock('../../httpClient', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

describe('authApi.confirmEmailChange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('posts uid, token, and encoded new email to the confirm endpoint', () => {
        authApi.confirmEmailChange('Nw', 'd5shai-7c6512e8c4e9d1a3991092fe0fcab0e', 'anVzdGNyZGVyckBnbWFpbC5jb20');

        expect(api.post).toHaveBeenCalledWith('/auth/confirm-email-change/', {
            uid: 'Nw',
            token: 'd5shai-7c6512e8c4e9d1a3991092fe0fcab0e',
            new_email: 'anVzdGNyZGVyckBnbWFpbC5jb20',
        });
    });
});
