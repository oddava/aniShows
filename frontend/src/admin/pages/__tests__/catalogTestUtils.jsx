import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Render an admin page with a fresh query client and a router at `path`.
 * `route` is the pattern the page is mounted on (for useParams).
 */
export function renderAdminPage(element, { path = '/', route = '*' } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path={route} element={element} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

/** An axios-like rejection with a response. */
export const apiError = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

export const page = (results) => ({ count: results.length, results });
