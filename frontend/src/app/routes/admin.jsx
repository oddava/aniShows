// Routes owned by G6 Admin. Composed by app/routes.jsx; only G6 edits this file.
import React, { Suspense } from 'react';
import { Navigate, Route } from 'react-router-dom';

import PageLoader from '../../components/common/PageLoader';
import lazyWithRetry from '../lazyWithRetry';

// Admin shell: lazy so no admin code (or admin.css) ships in the public entry.
// AdminLayout only loads after AdminRoute has confirmed the user is staff.
const AdminRoute = lazyWithRetry(() => import('../../components/AdminRoute'));
const AdminLayout = lazyWithRetry(() => import('../../components/AdminLayout'));

const AdminDashboard = lazyWithRetry(() => import('../../pages/admin/AdminDashboard'));
const AdminUsers = lazyWithRetry(() => import('../../pages/admin/AdminUsers'));
const AdminBadges = lazyWithRetry(() => import('../../pages/admin/AdminBadges'));
const AdminAnime = lazyWithRetry(() => import('../../pages/admin/AdminAnime'));
const AdminReviews = lazyWithRetry(() => import('../../pages/admin/AdminReviews'));
const AdminGenres = lazyWithRetry(() => import('../../pages/admin/AdminGenres'));
const AdminStudios = lazyWithRetry(() => import('../../pages/admin/AdminStudios'));
const AdminImportJobs = lazyWithRetry(() => import('../../pages/admin/AdminImportJobs'));
const AdminReports = lazyWithRetry(() => import('../../pages/admin/AdminReports'));
const AdminCharacters = lazyWithRetry(() => import('../../pages/admin/AdminCharacters'));
const AdminStaff = lazyWithRetry(() => import('../../pages/admin/AdminStaff'));
const AdminSettings = lazyWithRetry(() => import('../../pages/admin/AdminSettings'));
const AdminLogs = lazyWithRetry(() => import('../../pages/admin/AdminLogs'));
const AdminModeration = lazyWithRetry(() => import('../../pages/admin/AdminModeration'));
const AdminSystem = lazyWithRetry(() => import('../../pages/admin/AdminSystem'));

export const adminRoutes = (
    <>
        <Route
            path="/admin"
            element={(
                <Suspense fallback={<PageLoader />}>
                    <AdminRoute>
                        <AdminLayout />
                    </AdminRoute>
                </Suspense>
            )}
        >
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="badges" element={<AdminBadges />} />
            <Route path="anime" element={<AdminAnime />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="genres" element={<AdminGenres />} />
            <Route path="studios" element={<AdminStudios />} />
            <Route path="import-jobs" element={<AdminImportJobs />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="characters" element={<AdminCharacters />} />
            <Route path="staff" element={<AdminStaff />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="logs" element={<AdminLogs />} />
            <Route path="moderation" element={<AdminModeration />} />
            <Route path="system" element={<AdminSystem />} />
            {/* The old review-reports page became the moderation queue. */}
            <Route path="review-reports" element={<Navigate to="/admin/moderation" replace />} />
        </Route>
    </>
);
