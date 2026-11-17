// Routes owned by G1 Accounts & auth. Composed by app/routes.jsx; only G1 edits this file.
import React from 'react';
import { Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';
// Emailed-token pages load eagerly: their URL clean-up then runs in the first
// commit, before the async analytics script can track the token URL (A14).
import VerifyEmail from '../../pages/VerifyEmail';
import ConfirmEmailChange from '../../pages/ConfirmEmailChange';
import PasswordResetConfirm from '../../pages/PasswordResetConfirm';

const Profile = lazyWithRetry(() => import('../../pages/Profile'));
const Settings = lazyWithRetry(() => import('../../pages/Settings'));
const Login = lazyWithRetry(() => import('../../pages/Auth').then((module) => ({ default: module.Login })));
const Register = lazyWithRetry(() => import('../../pages/Auth').then((module) => ({ default: module.Register })));
const VerificationPending = lazyWithRetry(() => import('../../pages/VerificationPending'));
const PasswordReset = lazyWithRetry(() => import('../../pages/PasswordReset'));
const GoogleCallback = lazyWithRetry(() => import('../../pages/GoogleCallback'));
const Terms = lazyWithRetry(() => import('../../pages/Terms'));
const Privacy = lazyWithRetry(() => import('../../pages/Privacy'));

export const accountRoutes = (
    <>
        <Route path="profile/*" element={<Profile />} />
        <Route path="u/:username/*" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="verification-pending" element={<VerificationPending />} />
        {/* Emailed links: the page moves the token into router state and
            replaces the URL with the param-less route (A14). */}
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="verify-email/:uid/:token" element={<VerifyEmail />} />
        <Route path="confirm-email-change" element={<ConfirmEmailChange />} />
        <Route path="confirm-email-change/:uid/:token" element={<ConfirmEmailChange />} />
        {/* Links sent before pending_email; kept for one release. */}
        <Route
            path="confirm-email-change/:uid/:token/:new_email"
            element={<ConfirmEmailChange />}
        />
        <Route path="forgot-password" element={<PasswordReset />} />
        <Route path="reset-password" element={<PasswordResetConfirm />} />
        <Route path="reset-password/:uid/:token" element={<PasswordResetConfirm />} />
        <Route path="auth/google/callback" element={<GoogleCallback />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
    </>
);
