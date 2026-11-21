import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ExportPage from '../ExportPage';

const api = vi.hoisted(() => ({ exportData: vi.fn(), exportDataJSON: vi.fn() }));

vi.mock('../../api/client', () => ({ importExportApi: api }));
vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 7, username: 'kiyo' } }),
}));

const exported = {
    export_metadata: { version: '2' },
    profile: { bio: 'hello' },
    anime_list: [{ anime: { title: 'Frieren' }, status: 'Completed' }],
    favorites: [],
    reviews: [],
};

function renderPage() {
    return render(
        <MemoryRouter>
            <ExportPage />
        </MemoryRouter>,
    );
}

beforeEach(() => Object.values(api).forEach((mock) => mock.mockReset()));

describe('ExportPage', () => {
    it('renders the JSON preview from the {data} object', async () => {
        api.exportDataJSON.mockResolvedValue({ data: { data: exported } });
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

        expect(await screen.findByText('Anime list (1 entries)')).toBeInTheDocument();
        expect(screen.getByText(/"Frieren"/)).toBeInTheDocument();
        expect(screen.queryByText('Failed to load preview')).not.toBeInTheDocument();
    });

    it('says that entries without a MyAnimeList ID are left out of the XML', () => {
        renderPage();
        expect(screen.getByText(/without a MyAnimeList ID are left out of the XML/)).toBeInTheDocument();
    });

    it('reports how many entries the XML download left out', async () => {
        window.URL.createObjectURL = vi.fn(() => 'blob:x');
        window.URL.revokeObjectURL = vi.fn();
        api.exportData.mockResolvedValue({ data: '<myanimelist/>', headers: { 'x-export-skipped': '2' } });
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: /Download XML/i }));

        expect(await screen.findByText(/2 entries without a MyAnimeList ID were left out/)).toBeInTheDocument();
    });
});
