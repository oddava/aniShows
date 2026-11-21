// Pages that are themselves the sign-in / sign-up flow: the header hides its
// "Sign In" and "Get Started" buttons there.
const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verification-pending'];

export function isAuthFlowPath(pathname = '') {
    const path = pathname.replace(/\/+$/, '') || '/';
    return AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`));
}
