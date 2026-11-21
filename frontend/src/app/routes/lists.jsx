// Routes owned by G3 Lists & AniList sync. Composed by app/routes.jsx; only G3 edits this file.
import React from 'react';
import { Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const Library = lazyWithRetry(() => import('../../pages/Library'));
const ImportPage = lazyWithRetry(() => import('../../pages/ImportPage'));
const ExportPage = lazyWithRetry(() => import('../../pages/ExportPage'));

export const listRoutes = (
    <>
        {/* My List: the signed-in user's library (P2). */}
        <Route path="list" element={<Library />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="export" element={<ExportPage />} />
    </>
);
