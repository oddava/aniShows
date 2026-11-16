// Routes owned by G4 Notifications. Composed by app/routes.jsx; only G4 edits this file.
import React from 'react';
import { Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const Notifications = lazyWithRetry(() => import('../../pages/Notifications'));

export const notificationRoutes = (
    <>
        <Route path="notifications" element={<Notifications />} />
    </>
);
