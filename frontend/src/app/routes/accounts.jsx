// Routes owned by G1 Accounts & auth. Composed by app/routes.jsx; only G1 edits this file.
import React from 'react';
import { Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const Profile = lazyWithRetry(() => import('../../pages/Profile'));
const Settings = lazyWithRetry(() => import('../../pages/Settings'));
const Login = lazyWithRetry(() => import('../../pages/Auth').then((module) => ({ default: module.Login })));
const Register = lazyWithRetry(() => import('../../pages/Auth').then((module) => ({ default: module.Register })));
const VerifyEmail = lazyWithRetry(() => import('../../pages/VerifyEmail'));
const VerificationPending = lazyWithRetry(() => import('../../pages/VerificationPending'));
const ConfirmEmailChange = lazyWithRetry(() => import('../../pages/ConfirmEmailChange'));
const PasswordReset = lazyWithRetry(() => import('../../pages/PasswordReset'));
const PasswordResetConfirm = lazyWithRetry(() => import('../../pages/PasswordResetConfirm'));
const GoogleCallback = lazyWithRetry(() => import('../../pages/GoogleCallback'));
const Terms = lazyWithRetry(() => import('../../pages/Terms'));
const Privacy = lazyWithRetry(() => import('../../pages/Privacy'));

export const accountRoutes = (
    <>
        <Route path="profile/*" element={<Profile />} />
        <Route path="u/:username/*" element={<Profile />} />
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
    </>
);
