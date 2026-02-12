
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import GoogleAnalytics from './components/GoogleAnalytics';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy loaded pages
const Home = lazy(() => import('./pages/Home'));
const Browse = lazy(() => import('./pages/Browse'));
const AnimeDetail = lazy(() => import('./pages/AnimeDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Auth').then(module => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Auth').then(module => ({ default: module.Register })));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const VerificationPending = lazy(() => import('./pages/VerificationPending'));
const ConfirmEmailChange = lazy(() => import('./pages/ConfirmEmailChange'));
const PasswordReset = lazy(() => import('./pages/PasswordReset'));
const PasswordResetConfirm = lazy(() => import('./pages/PasswordResetConfirm'));
const GoogleCallback = lazy(() => import('./pages/GoogleCallback'));
const Terms = lazy(() => import('./pages/Terms'));
const Privacy = lazy(() => import('./pages/Privacy'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Seasonal = lazy(() => import('./pages/Seasonal'));
const Schedule = lazy(() => import('./pages/Schedule'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));

// Admin imports
const AdminLayout = lazy(() => import('./components/AdminLayout'));
const AdminRoute = lazy(() => import('./components/AdminRoute'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminAnime = lazy(() => import('./pages/admin/AdminAnime'));
const AdminReviews = lazy(() => import('./pages/admin/AdminReviews'));
const AdminGenres = lazy(() => import('./pages/admin/AdminGenres'));
const AdminStudios = lazy(() => import('./pages/admin/AdminStudios'));
const AdminUserLists = lazy(() => import('./pages/admin/AdminUserLists'));
const AdminFavorites = lazy(() => import('./pages/admin/AdminFavorites'));
const AdminImportJobs = lazy(() => import('./pages/admin/AdminImportJobs'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));
const AdminCharacters = lazy(() => import('./pages/admin/AdminCharacters'));
const AdminStaff = lazy(() => import('./pages/admin/AdminStaff'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminLogs = lazy(() => import('./pages/admin/AdminLogs'));
const AdminReviewReports = lazy(() => import('./pages/admin/AdminReviewReports'));

// Loading Fallback Component
const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes - data considered fresh
      gcTime: 1000 * 60 * 30,   // 30 minutes - cache retention
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <AuthProvider>
            <BrowserRouter>
            <ScrollToTop />
            <GoogleAnalytics />
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
                  <Route path="confirm-email-change/:uid/:token/:new_email" element={<ConfirmEmailChange />} />
                  <Route path="forgot-password" element={<PasswordReset />} />
                  <Route path="reset-password/:uid/:token" element={<PasswordResetConfirm />} />
                  <Route path="auth/google/callback" element={<GoogleCallback />} />
                  <Route path="terms" element={<Terms />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="import" element={<ImportPage />} />
                  <Route path="export" element={<ExportPage />} />
                </Route>

                {/* Admin Routes */}
                <Route path="/admin" element={
                  <AdminRoute>
                    <AdminLayout />
                  </AdminRoute>
                }>
                  <Route index element={<AdminDashboard />} />
                  <Route path="users" element={<AdminUsers />} />
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
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: '#1a1a1a',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                },
                success: {
                  iconTheme: {
                    primary: '#10b981',
                    secondary: '#fff',
                  },
                },
                error: {
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </BrowserRouter>
        </AuthProvider>
      </ErrorBoundary>
    </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;
