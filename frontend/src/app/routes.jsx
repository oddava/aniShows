import React, { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from '../components/Layout';
import PageLoader from '../components/common/PageLoader';
import lazyWithRetry from './lazyWithRetry';
import { accountRoutes } from './routes/accounts';
import { adminRoutes } from './routes/admin';
import { browseRoutes } from './routes/browse';
import { communityRoutes } from './routes/community';
import { listRoutes } from './routes/lists';
import { notificationRoutes } from './routes/notifications';

/*
 * Route shell. Each group owns its routes in app/routes/<group>.jsx (exported as a
 * fragment of <Route> elements); this file only composes them and is frozen. React
 * Router ranks routes by specificity, so the order of the blocks does not matter.
 */

const NotFound = lazyWithRetry(() => import('../pages/NotFound'));

export { preloadForumChunks } from './routes/community';

export default function AppRoutes() {
    return (
        <Suspense fallback={<PageLoader />}>
            <Routes>
                <Route element={<Layout />}>
                    {browseRoutes}
                    {accountRoutes}
                    {notificationRoutes}
                    {listRoutes}
                    {communityRoutes}
                    {/* Inside Layout, so a dead link still has the nav and footer. */}
                    <Route path="*" element={<NotFound />} />
                </Route>

                {adminRoutes}
            </Routes>
        </Suspense>
    );
}
