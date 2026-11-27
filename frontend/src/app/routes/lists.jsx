// Routes owned by G3 Lists & AniList sync. Composed by app/routes.jsx; only G3 edits this file.
import React from 'react';
import { Navigate, Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const Library = lazyWithRetry(() => import('../../pages/Library'));

/** Import and export live in Settings now; the old addresses still work. */
export const DATA_SETTINGS_PATH = '/settings?tab=data';

export const listRoutes = (
    <>
        {/* My List: the signed-in user's library (P2). */}
        <Route path="list" element={<Library />} />
        <Route path="import" element={<Navigate to={DATA_SETTINGS_PATH} replace />} />
        <Route path="export" element={<Navigate to={DATA_SETTINGS_PATH} replace />} />
    </>
);
