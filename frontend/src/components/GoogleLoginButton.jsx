import { Chrome } from 'lucide-react';
import { startGoogleSignIn } from './auth/googleSignIn';

/** `returnTo` is where to land after signing in (same-origin path only). */
export default function GoogleLoginButton({ returnTo }) {
    return (
        <button
            type="button"
            onClick={() => startGoogleSignIn({ returnTo })}
            className="w-full flex items-center justify-center gap-2 bg-white text-gray-900 font-semibold py-3 px-4 rounded-xl hover:bg-gray-100 transition-colors duration-200"
        >
            <Chrome className="w-5 h-5 text-[#DB4437]" aria-hidden="true" />
            Continue with Google
        </button>
    );
}
