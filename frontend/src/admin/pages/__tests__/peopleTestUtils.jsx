import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Recharts' ResponsiveContainer needs it; jsdom has none.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}

        unobserve() {}

        disconnect() {}
    };
}

export const SUPERUSER = { id: 1, username: 'root', is_staff: true, is_superuser: true };
export const STAFF = { id: 2, username: 'mod', is_staff: true, is_superuser: false };

/** Render one admin page at `path` (matched by `route`) with a fresh query cache. */
export function renderPage(element, { path, route = path } = {}) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path={route} element={element} />
                    <Route path="*" element={<p>Elsewhere</p>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}
