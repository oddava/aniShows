import React, { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import AdminLayout from '../components/AdminLayout';
import AdminRoute from '../components/AdminRoute';
import Layout from '../components/Layout';

const lazyWithRetry = (importer, retries = 1, retryDelayMs = 250) => lazy(async () => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await importer();
        } catch (error) {
            lastError = error;
            const message = (error?.message || '').toLowerCase();
            const isModuleLoadFailure =
                message.includes('failed to fetch dynamically imported module') ||
                message.includes('error loading dynamically imported module');

            if (!isModuleLoadFailure || attempt === retries) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
    }

    throw lastError;
});

const Home = lazyWithRetry(() => import('../pages/Home'));
const Browse = lazyWithRetry(() => import('../pages/Browse'));
const AnimeDetail = lazyWithRetry(() => import('../pages/AnimeDetail'));
const Profile = lazyWithRetry(() => import('../pages/Profile'));
const Settings = lazyWithRetry(() => import('../pages/Settings'));
const Login = lazyWithRetry(() => import('../pages/Auth').then((module) => ({ default: module.Login })));
const Register = lazyWithRetry(() => import('../pages/Auth').then((module) => ({ default: module.Register })));
const VerifyEmail = lazyWithRetry(() => import('../pages/VerifyEmail'));
const VerificationPending = lazyWithRetry(() => import('../pages/VerificationPending'));
const ConfirmEmailChange = lazyWithRetry(() => import('../pages/ConfirmEmailChange'));
const PasswordReset = lazyWithRetry(() => import('../pages/PasswordReset'));
const PasswordResetConfirm = lazyWithRetry(() => import('../pages/PasswordResetConfirm'));
const GoogleCallback = lazyWithRetry(() => import('../pages/GoogleCallback'));
const Terms = lazyWithRetry(() => import('../pages/Terms'));
const Privacy = lazyWithRetry(() => import('../pages/Privacy'));
const NotFound = lazyWithRetry(() => import('../pages/NotFound'));
const Seasonal = lazyWithRetry(() => import('../pages/Seasonal'));
const Schedule = lazyWithRetry(() => import('../pages/Schedule'));
const ImportPage = lazyWithRetry(() => import('../pages/ImportPage'));
const ExportPage = lazyWithRetry(() => import('../pages/ExportPage'));
const VoiceActorDetail = lazyWithRetry(() => import('../pages/VoiceActorDetail'));

const forumCategoryListImport = () => import('../pages/forums/ForumCategoryList');
const forumThreadListImport = () => import('../pages/forums/ForumThreadList');
const forumThreadDetailImport = () => import('../pages/forums/ForumThreadDetail');
const createThreadImport = () => import('../pages/forums/CreateThread');

const ForumCategoryList = lazyWithRetry(forumCategoryListImport);
const ForumThreadList = lazyWithRetry(forumThreadListImport);
const ForumThreadDetail = lazyWithRetry(forumThreadDetailImport);
const CreateThread = lazyWithRetry(createThreadImport);

const AdminDashboard = lazyWithRetry(() => import('../pages/admin/AdminDashboard'));
const AdminUsers = lazyWithRetry(() => import('../pages/admin/AdminUsers'));
const AdminBadges = lazyWithRetry(() => import('../pages/admin/AdminBadges'));
const AdminAnime = lazyWithRetry(() => import('../pages/admin/AdminAnime'));
const AdminReviews = lazyWithRetry(() => import('../pages/admin/AdminReviews'));
const AdminGenres = lazyWithRetry(() => import('../pages/admin/AdminGenres'));
const AdminStudios = lazyWithRetry(() => import('../pages/admin/AdminStudios'));
const AdminUserLists = lazyWithRetry(() => import('../pages/admin/AdminUserLists'));
const AdminFavorites = lazyWithRetry(() => import('../pages/admin/AdminFavorites'));
const AdminImportJobs = lazyWithRetry(() => import('../pages/admin/AdminImportJobs'));
const AdminReports = lazyWithRetry(() => import('../pages/admin/AdminReports'));
const AdminCharacters = lazyWithRetry(() => import('../pages/admin/AdminCharacters'));
const AdminStaff = lazyWithRetry(() => import('../pages/admin/AdminStaff'));
const AdminSettings = lazyWithRetry(() => import('../pages/admin/AdminSettings'));
const AdminLogs = lazyWithRetry(() => import('../pages/admin/AdminLogs'));
const AdminReviewReports = lazyWithRetry(() => import('../pages/admin/AdminReviewReports'));

const PageLoader = () => (
    <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
);

export const preloadForumChunks = () => {
    forumCategoryListImport();
    forumThreadListImport();
    forumThreadDetailImport();
    createThreadImport();
};

export default function AppRoutes() {
    return (
        <Suspense fallback={<PageLoader />}>
            <Routes>
                <Route element={<Layout />}>
                    <Route index element={<Home />} />
                    <Route path="browse" element={<Browse />} />
                    <Route path="seasonal" element={<Seasonal />} />
                    <Route path="schedule" element={<Schedule />} />
                    <Route path="anime/:slug" element={<AnimeDetail />} />
                    <Route path="profile" element={<Profile />} />
                    <Route path="profile/:username" element={<Profile />} />
                    <Route path="kiyo" element={<Profile forcedUsername="kiyo" />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="login" element={<Login />} />
                    <Route path="register" element={<Register />} />
                    <Route path="verification-pending" element={<VerificationPending />} />
                    <Route path="verify-email/:uid/:token" element={<VerifyEmail />} />
                    <Route
                        path="confirm-email-change/:uid/:token/:new_email"
                        element={<ConfirmEmailChange />}
                    />
                    <Route path="forgot-password" element={<PasswordReset />} />
                    <Route path="reset-password/:uid/:token" element={<PasswordResetConfirm />} />
                    <Route path="auth/google/callback" element={<GoogleCallback />} />
                    <Route path="terms" element={<Terms />} />
                    <Route path="privacy" element={<Privacy />} />
                    <Route path="import" element={<ImportPage />} />
                    <Route path="export" element={<ExportPage />} />
                    <Route path="staff/:id" element={<VoiceActorDetail />} />
                    <Route path="forums" element={<ForumCategoryList />} />
                    <Route path="forums/create" element={<CreateThread />} />
                    <Route path="forums/category/:slug" element={<ForumThreadList />} />
                    <Route path="forums/category/:slug/create" element={<CreateThread />} />
                    <Route path="forums/thread/:id" element={<ForumThreadDetail />} />
                </Route>

                <Route
                    path="/admin"
                    element={(
                        <AdminRoute>
                            <AdminLayout />
                        </AdminRoute>
                    )}
                >
                    <Route index element={<AdminDashboard />} />
                    <Route path="users" element={<AdminUsers />} />
                    <Route path="badges" element={<AdminBadges />} />
                    <Route path="anime" element={<AdminAnime />} />
                    <Route path="reviews" element={<AdminReviews />} />
                    <Route path="genres" element={<AdminGenres />} />
                    <Route path="studios" element={<AdminStudios />} />
                    <Route path="user-lists" element={<AdminUserLists />} />
                    <Route path="favorites" element={<AdminFavorites />} />
                    <Route path="import-jobs" element={<AdminImportJobs />} />
                    <Route path="reports" element={<AdminReports />} />
                    <Route path="characters" element={<AdminCharacters />} />
                    <Route path="staff" element={<AdminStaff />} />
                    <Route path="settings" element={<AdminSettings />} />
                    <Route path="logs" element={<AdminLogs />} />
                    <Route path="review-reports" element={<AdminReviewReports />} />
                </Route>
                <Route path="*" element={<NotFound />} />
            </Routes>
        </Suspense>
    );
}
