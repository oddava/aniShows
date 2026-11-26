import { X } from 'lucide-react';

/** ReviewReport.Reason values, in plain words. */
export const REPORT_REASONS = {
    spoiler: 'Spoiler',
    spam: 'Spam',
    harassment: 'Harassment',
    hate_speech: 'Hate speech',
    misinformation: 'Misinformation',
    off_topic: 'Off topic',
    other: 'Other',
};

export const REASON_OPTIONS = Object.entries(REPORT_REASONS).map(([value, label]) => ({ value, label }));

/** Heuristic quality signals (never user reports). */
export const SIGNAL_LABELS = {
    low_rating: 'Low rating',
    spoiler_tag: 'Spoiler tag',
    empty_text: 'No text',
};

export const RATING_OPTIONS = Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));

export const NOTES_MAX = 1000;
export const REMOVAL_REASON_MAX = 200;

export { useOpenParam } from '../../hooks';

export { FilterChip } from '../../ui';

/** User-generated text, shown as plain text with its line breaks. */
export function PlainText({ text, empty = 'No text.', className = '' }) {
    if (!text || !String(text).trim()) {
        return <p className={`text-sm italic text-[var(--text-3)] ${className}`}>{empty}</p>;
    }
    return (
        <p className={`whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-1)] [overflow-wrap:anywhere] ${className}`}>
            {text}
        </p>
    );
}

/** "7/10" with the denominator muted. */
export function Rating({ value }) {
    if (value === null || value === undefined) return <span className="text-[var(--text-3)]">—</span>;
    return (
        <span className="font-semibold tabular text-[var(--text-1)]">
            {value}
            <span className="font-normal text-[var(--text-3)]">/10</span>
        </span>
    );
}
