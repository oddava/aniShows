import { RefreshCw } from 'lucide-react';

import Skeleton from '../../components/ui/Skeleton';
import { errorMessage } from '../api';
import Button from './Button';

/**
 * A failed load: what went wrong in a sentence and a way to try again.
 * A 403 says plainly that this needs a superuser.
 */
export function ErrorState({ error, onRetry, title, compact = false }) {
    const status = error?.response?.status;
    const forbidden = status === 403;
    const heading = title || (forbidden ? 'Superusers only' : 'Could not load this');
    const message = forbidden
        ? 'Your account can moderate but not open this. Ask a superuser if you need it.'
        : errorMessage(error, 'The server did not answer as expected.');
    return (
        <div role="alert" className={`text-center ${compact ? 'py-6' : 'py-12'}`}>
            <p className="text-base font-semibold text-[var(--text-1)]">{heading}</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-[var(--text-2)]">{message}</p>
            {onRetry && !forbidden && (
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => onRetry()} className="mt-4">
                    Try again
                </Button>
            )}
        </div>
    );
}

/** A panel-shaped placeholder: a title bar and a few lines. */
export function PanelSkeleton({ lines = 4, className = '' }) {
    return (
        <div aria-hidden="true" className={`rounded-[var(--radius-lg)] bg-[var(--ink-1)] p-4 sm:p-5 ${className}`}>
            <Skeleton className="h-4 w-40" />
            <div className="mt-5 space-y-3">
                {Array.from({ length: lines }, (_, index) => (
                    <Skeleton key={index} className={`h-3.5 ${index % 3 === 2 ? 'w-1/2' : index % 2 ? 'w-3/4' : 'w-full'}`} />
                ))}
            </div>
        </div>
    );
}

/** A note inside a page: a soft tinted block, no icon art. */
export function Notice({ tone = 'neutral', title, children, action, className = '' }) {
    const tones = {
        neutral: 'bg-white/[0.04]',
        accent: 'bg-[var(--signature-soft)]',
        warning: 'bg-[var(--warning-soft)]',
        danger: 'bg-[var(--danger-soft)]',
        success: 'bg-[var(--success-soft)]',
    };
    const titleTones = {
        neutral: 'text-[var(--text-1)]',
        accent: 'text-[var(--signature)]',
        warning: 'text-[var(--status-on-hold)]',
        danger: 'text-[var(--danger)]',
        success: 'text-[var(--success)]',
    };
    return (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-4 py-3 ${tones[tone] || tones.neutral} ${className}`}>
            <div className="min-w-0 text-sm leading-relaxed">
                {title && <p className={`font-semibold ${titleTones[tone] || titleTones.neutral}`}>{title}</p>}
                {children && <div className="text-[var(--text-2)]">{children}</div>}
            </div>
            {action}
        </div>
    );
}
