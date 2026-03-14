import React, { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import AdminLayout from '../components/AdminLayout';
import AdminRoute from '../components/AdminRoute';
import Layout from '../components/Layout';

const Home = lazy(() => import('../pages/Home'));
const Browse = lazy(() => import('../pages/Browse'));
const AnimeDetail = lazy(() => import('../pages/AnimeDetail'));
const Profile = lazy(() => import('../pages/Profile'));
const Settings = lazy(() => import('../pages/Settings'));
const Login = lazy(() => import('../pages/Auth').then((module) => ({ default: module.Login })));
const Register = lazy(() => import('../pages/Auth').then((module) => ({ default: module.Register })));
const VerifyEmail = lazy(() => import('../pages/VerifyEmail'));
const VerificationPending = lazy(() => import('../pages/VerificationPending'));
const ConfirmEmailChange = lazy(() => import('../pages/ConfirmEmailChange'));
const PasswordReset = lazy(() => import('../pages/PasswordReset'));
const PasswordResetConfirm = lazy(() => import('../pages/PasswordResetConfirm'));
const GoogleCallback = lazy(() => import('../pages/GoogleCallback'));
const Terms = lazy(() => import('../pages/Terms'));
const Privacy = lazy(() => import('../pages/Privacy'));
const NotFound = lazy(() => import('../pages/NotFound'));
const Seasonal = lazy(() => import('../pages/Seasonal'));
const Schedule = lazy(() => import('../pages/Schedule'));
const ImportPage = lazy(() => import('../pages/ImportPage'));
const ExportPage = lazy(() => import('../pages/ExportPage'));
const VoiceActorDetail = lazy(() => import('../pages/VoiceActorDetail'));

const forumCategoryListImport = () => import('../pages/forums/ForumCategoryList');
const forumThreadListImport = () => import('../pages/forums/ForumThreadList');
const forumThreadDetailImport = () => import('../pages/forums/ForumThreadDetail');
const createThreadImport = () => import('../pages/forums/CreateThread');

const ForumCategoryList = lazy(forumCategoryListImport);
const ForumThreadList = lazy(forumThreadListImport);
const ForumThreadDetail = lazy(forumThreadDetailImport);
const CreateThread = lazy(createThreadImport);

const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('../pages/admin/AdminUsers'));
const AdminBadges = lazy(() => import('../pages/admin/AdminBadges'));
const AdminAnime = lazy(() => import('../pages/admin/AdminAnime'));
const AdminReviews = lazy(() => import('../pages/admin/AdminReviews'));
const AdminGenres = lazy(() => import('../pages/admin/AdminGenres'));
const AdminStudios = lazy(() => import('../pages/admin/AdminStudios'));
const AdminUserLists = lazy(() => import('../pages/admin/AdminUserLists'));
const AdminFavorites = lazy(() => import('../pages/admin/AdminFavorites'));
const AdminImportJobs = lazy(() => import('../pages/admin/AdminImportJobs'));
const AdminReports = lazy(() => import('../pages/admin/AdminReports'));
const AdminCharacters = lazy(() => import('../pages/admin/AdminCharacters'));
const AdminStaff = lazy(() => import('../pages/admin/AdminStaff'));
const AdminSettings = lazy(() => import('../pages/admin/AdminSettings'));
const AdminLogs = lazy(() => import('../pages/admin/AdminLogs'));
const AdminReviewReports = lazy(() => import('../pages/admin/AdminReviewReports'));

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
