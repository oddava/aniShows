import { Chrome } from 'lucide-react';

export default function GoogleLoginButton() {
    const handleLogin = () => {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        const redirectUri = `${window.location.origin}/auth/google/callback`;
        const scope = 'profile email';
        const responseType = 'code';
        const accessType = 'online';

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=${responseType}&scope=${encodeURIComponent(scope)}&access_type=${accessType}&include_granted_scopes=true`;

        window.location.href = authUrl;
    };

    return (
        <button
            type="button"
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 bg-white text-gray-900 font-semibold py-3 px-4 rounded-xl hover:bg-gray-100 transition-colors duration-200"
        >
            <Chrome className="w-5 h-5 text-[#DB4437]" />
            Continue with Google
        </button>
    );
}
