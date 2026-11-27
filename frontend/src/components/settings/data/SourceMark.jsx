/**
 * A site's mark: its initials on its own colour, so MyAnimeList and AniList
 * are told apart at a glance (no logos are used).
 */
const MARKS = {
    mal: { text: 'MAL', className: 'bg-[#2e51a2] text-white' },
    anilist: { text: 'AL', className: 'bg-[#152232] text-[#3db4f2]' },
};

const SIZES = {
    md: 'h-10 w-10 rounded-[10px] text-[12px]',
    sm: 'h-8 w-8 rounded-lg text-[10px]',
};

export default function SourceMark({ source, size = 'md' }) {
    const mark = MARKS[source] ?? MARKS.mal;
    return (
        <span
            aria-hidden="true"
            className={`inline-flex shrink-0 items-center justify-center font-bold tracking-tight ${SIZES[size]} ${mark.className}`}
        >
            {mark.text}
        </span>
    );
}
