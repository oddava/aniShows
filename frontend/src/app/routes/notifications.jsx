// Routes owned by G4 Notifications. Composed by app/routes.jsx; only G4 edits this file.
import React from 'react';
import { Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const Notifications = lazyWithRetry(() => import('../../pages/Notifications'));
// The landing page for the unsubscribe link in episode emails. Open to signed-out
// visitors: the signed token in the link is the only credential.
const EmailUnsubscribe = lazyWithRetry(() => import('../../pages/NotificationPreferences'));

export const notificationRoutes = (
    <>
        <Route path="notifications" element={<Notifications />} />
        {/* A static segment, so React Router ranks it above "notifications" on its own. */}
        <Route path="notifications/unsubscribe" element={<EmailUnsubscribe />} />
    </>
);
