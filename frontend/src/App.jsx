import React from 'react';

import AppProviders from './app/providers';
import AppRoutes, { preloadForumChunks } from './app/routes';

function App() {
    return (
        <AppProviders>
            <AppRoutes />
        </AppProviders>
    );
}

export default App;
export { preloadForumChunks };
