/**
 * Client-side mirror of the server's password rules (Django's
 * AUTH_PASSWORD_VALIDATORS), so people see problems before submitting.
 * The server stays authoritative: it also rejects common passwords and ones
 * too similar to the username or email, which can't be checked here.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_HINT =
    `At least ${PASSWORD_MIN_LENGTH} characters, not only numbers, and not a common password.`;

export const getPasswordProblem = (password) => {
    if (password.length < PASSWORD_MIN_LENGTH) {
        return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (/^\d+$/.test(password)) {
        return 'Password cannot be entirely numeric.';
    }
    return null;
};
