import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Render an admin page at `path` with a fresh query client and router. */
export function renderAdminPage(element, { path = '/admin', route = '/admin/*' } = {}) {
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

/** A mocked adminApi.get answering by exact path; unknown paths reject with a 404. */
export function routeGets(getMock, table) {
    getMock.mockImplementation((path) => {
        const answer = table[path];
        if (answer !== undefined) return Promise.resolve(typeof answer === 'function' ? answer() : answer);
        return Promise.reject(Object.assign(new Error(`unexpected GET ${path}`), { response: { status: 404, data: {} } }));
    });
}
