import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import useAdultContentPreference from '../../hooks/useAdultContentPreference';
import SEO from '../SEO';

/** The API's answer for an 18+ title the viewer has not opted in to (D-2). */
export const ADULT_GATE_CODE = 'adult_content_opt_in_required';

export const isAdultGateError = (error) => (
    error?.response?.status === 403 && error?.response?.data?.code === ADULT_GATE_CODE
);

/**
 * Shown instead of an adult title's page for viewers who have not opted in (D-2): an opt-in,
 * not a 404, so shared links keep working. Members turn adult content on here (the same
 * setting as Settings, Browse and Schedule); guests sign in first and come back.
 */
export default function AdultContentGate({ onEnabled }) {
    const location = useLocation();
    const { isAuthenticated } = useAuth();
    const { toggle, isUpdating } = useAdultContentPreference();
    const [failed, setFailed] = useState(false);

    const enable = async () => {
        setFailed(false);
        try {
            await toggle();
            onEnabled?.();
        } catch {
            setFailed(true);
        }
    };

    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4 pt-24">
            <SEO page="notFound" noIndex />
            <div className="ui-empty-state w-full max-w-lg">
                <h1 className="text-lg font-semibold text-white mb-2">18+ title</h1>
                <p className="text-sm text-gray-400 mb-6">
                    AniList marks this title as adult content. It is hidden unless you turn on adult
                    content{isAuthenticated ? '' : ', which needs an account'}. You can change this in
                    Settings at any time.
                </p>
                {failed && (
                    <p role="alert" className="text-sm text-red-400 mb-4">
                        Couldn’t update your setting. Try again in a moment.
                    </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {isAuthenticated ? (
                        <button
                            type="button"
                            className="btn-primary text-sm"
                            onClick={enable}
                            disabled={isUpdating}
                        >
                            {isUpdating ? 'Turning on…' : 'Show adult content'}
                        </button>
                    ) : (
                        <Link
                            to="/login"
                            state={{ from: `${location.pathname}${location.search}` }}
                            className="btn-primary text-sm"
                        >
                            Sign in
                        </Link>
                    )}
                    <Link to="/browse" className="btn-secondary text-sm">Browse Anime</Link>
                </div>
            </div>
        </div>
    );
}
