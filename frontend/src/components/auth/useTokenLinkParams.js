import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

/**
 * Keep emailed tokens out of the address bar (A14).
 *
 * Reset, verify and email-change links carry their token in the path. On the
 * first commit this hook moves those params into router state and replaces
 * the entry with `cleanPath`, so the token stays out of browser history and a
 * later copy of the URL. A fresh load from the email is replaced before the
 * analytics script has loaded (it is async and reads window.location when it
 * tracks), so the pageview carries no token either. The param-less route
 * renders the page again with the values read back from state; a reload keeps
 * them, since history state survives it.
 *
 * Returns `{ linkParams, isRedirecting }`. `linkParams` is null until the
 * values are in state (or when the page was opened without them).
 */
export default function useTokenLinkParams(required, cleanPath, optional = []) {
    const params = useParams();
    const location = useLocation();
    const navigate = useNavigate();

    const inUrl = required.every((name) => Boolean(params[name]));
    const fromUrl = inUrl
        ? Object.fromEntries(
            [...required, ...optional]
                .filter((name) => params[name])
                .map((name) => [name, params[name]]),
        )
        : null;
    const stored = location.state?.linkParams;
    const fromState = stored && required.every((name) => typeof stored[name] === 'string')
        ? stored
        : null;

    // An effect, not a layout effect: the router subscribes to history in its own
    // layout effect, which runs after this component's, so a navigate() from a
    // child layout effect on first mount would go unseen.
    useEffect(() => {
        if (!fromUrl) return;
        navigate(cleanPath, {
            replace: true,
            state: { ...(location.state || {}), linkParams: fromUrl },
        });
        // Runs once per URL; fromUrl is derived from it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);

    return { linkParams: fromUrl ? null : fromState, isRedirecting: Boolean(fromUrl) };
}
