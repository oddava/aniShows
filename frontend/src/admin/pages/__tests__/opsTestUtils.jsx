import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/** jsdom has no ResizeObserver; recharts' ResponsiveContainer needs one. */
export function installResizeObserver() {
    if (typeof globalThis.ResizeObserver === 'function') return;
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

export const SUPERUSER = { id: 1, username: 'root', is_staff: true, is_superuser: true };
export const STAFF = { id: 2, username: 'mod', is_staff: true, is_superuser: false };

let lastLocation = null;
function LocationProbe() {
    lastLocation = useLocation();
    return null;
}
export const currentLocation = () => lastLocation;

/** Render an admin page at `path` with a fresh query client and router. */
export function renderPage(element, { path = '/admin', route = '/admin/*' } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path={route} element={<>{element}<LocationProbe /></>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

/** An axios-shaped rejection. */
export const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
