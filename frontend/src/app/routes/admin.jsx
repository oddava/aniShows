// Admin routes. Composed by app/routes.jsx. Everything under /admin is lazy, so
// no admin code (or admin.css) ships in the public entry, and the shell only
// loads once AdminGate has confirmed the user is staff.
import React, { Suspense } from 'react';
import { Navigate, Route } from 'react-router-dom';

import PageLoader from '../../components/common/PageLoader';
import lazyWithRetry from '../lazyWithRetry';

const AdminGate = lazyWithRetry(() => import('../../admin/shell/AdminGate'));
const AdminShell = lazyWithRetry(() => import('../../admin/shell/AdminShell'));

const page = (load) => lazyWithRetry(load);
const Dashboard = page(() => import('../../admin/pages/Dashboard'));
const Analytics = page(() => import('../../admin/pages/Analytics'));
const Moderation = page(() => import('../../admin/pages/Moderation'));
const Reviews = page(() => import('../../admin/pages/Reviews'));
const Forums = page(() => import('../../admin/pages/Forums'));
const Users = page(() => import('../../admin/pages/Users'));
const UserDetail = page(() => import('../../admin/pages/UserDetail'));
const Badges = page(() => import('../../admin/pages/Badges'));
const Announcements = page(() => import('../../admin/pages/Announcements'));
const Anime = page(() => import('../../admin/pages/Anime'));
const AnimeDetail = page(() => import('../../admin/pages/AnimeDetail'));
const Genres = page(() => import('../../admin/pages/Genres'));
const Studios = page(() => import('../../admin/pages/Studios'));
const Characters = page(() => import('../../admin/pages/Characters'));
const People = page(() => import('../../admin/pages/People'));
const SyncHealth = page(() => import('../../admin/pages/SyncHealth'));
const Imports = page(() => import('../../admin/pages/Imports'));
const ListImports = page(() => import('../../admin/pages/ListImports'));
const System = page(() => import('../../admin/pages/System'));
const Tasks = page(() => import('../../admin/pages/Tasks'));
const Logs = page(() => import('../../admin/pages/Logs'));
const Settings = page(() => import('../../admin/pages/Settings'));
const AdminNotFound = page(() => import('../../admin/pages/AdminNotFound'));

export const adminRoutes = (
    <Route
        path="/admin"
        element={(
            <Suspense fallback={<PageLoader />}>
                <AdminGate>
                    <AdminShell />
                </AdminGate>
            </Suspense>
        )}
    >
        <Route index element={<Dashboard />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="moderation" element={<Moderation />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="forums" element={<Forums />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:userId" element={<UserDetail />} />
        <Route path="badges" element={<Badges />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="anime" element={<Anime />} />
        <Route path="anime/:animeId" element={<AnimeDetail />} />
        <Route path="genres" element={<Genres />} />
        <Route path="studios" element={<Studios />} />
        <Route path="characters" element={<Characters />} />
        <Route path="people" element={<People />} />
        <Route path="sync-health" element={<SyncHealth />} />
        <Route path="imports" element={<Imports />} />
        <Route path="list-imports" element={<ListImports />} />
        <Route path="system" element={<System />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />

        {/* Old admin addresses, so bookmarks keep working. */}
        <Route path="reports" element={<Navigate to="/admin/analytics" replace />} />
        <Route path="import-jobs" element={<Navigate to="/admin/imports" replace />} />
        <Route path="staff" element={<Navigate to="/admin/people" replace />} />
        <Route path="review-reports" element={<Navigate to="/admin/moderation" replace />} />

        <Route path="*" element={<AdminNotFound />} />
    </Route>
);
