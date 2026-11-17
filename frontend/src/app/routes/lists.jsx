// Routes owned by G3 Lists & AniList sync. Composed by app/routes.jsx; only G3 edits this file.
import React from 'react';
import { Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const ImportPage = lazyWithRetry(() => import('../../pages/ImportPage'));
const ExportPage = lazyWithRetry(() => import('../../pages/ExportPage'));

export const listRoutes = (
    <>
        <Route path="import" element={<ImportPage />} />
        <Route path="export" element={<ExportPage />} />
    </>
);
