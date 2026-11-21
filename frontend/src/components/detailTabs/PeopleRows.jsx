import { memo } from 'react';
import { Link } from 'react-router-dom';
import Portrait from '../ui/Portrait';
import { getPortraitSrcSet, getPortraitUrl } from './portraits';
import { capsToSentence, displayPersonName, roleToSentence } from './format';

const PORTRAIT_CLASS = 'h-[60px] w-10 flex-shrink-0 rounded-[var(--radius-sm)]';

function PersonPortrait({ entity }) {
    return (
        <Portrait
            src={getPortraitUrl(entity)}
            srcSet={getPortraitSrcSet(entity)}
            sizes="48px"
            alt=""
            className={PORTRAIT_CLASS}
        />
    );
}

/**
 * One character: portrait, name, and a meta line with the role and the voice
 * actor ("Main · Tachibana Tatsumaru"). The row reads complete with or
 * without a voice actor, and names wrap instead of being cut short.
 */
export const CharacterRow = memo(function CharacterRow({ role }) {
    const characterHref = `/character/${role.character.id}`;
    const actor = role.voice_actor?.name ? role.voice_actor : null;
    const roleLabel = role.role ? capsToSentence(role.role) : '';

    return (
        <div className="flex min-h-[60px] items-center gap-3">
            <Link to={characterHref} tabIndex={-1} aria-hidden="true" className="flex-shrink-0">
                <PersonPortrait entity={role.character} />
            </Link>
            <div className="min-w-0 flex-1">
                <Link
                    to={characterHref}
                    className="line-clamp-2 break-words text-[15px] font-medium leading-snug text-[var(--text-1)] hover:text-[var(--signature)]"
                >
                    {displayPersonName(role.character.name)}
                </Link>
                {(roleLabel || actor) && (
                    <p className="mt-0.5 line-clamp-1 text-sm text-[var(--text-3)]">
                        {roleLabel}
                        {roleLabel && actor && ' · '}
                        {actor && <span className="sr-only">voiced by </span>}
                        {actor && (
                            <Link
                                to={`/staff/${actor.id}`}
                                className="text-[var(--text-2)] hover:text-[var(--signature)]"
                            >
                                {displayPersonName(actor.name)}
                            </Link>
                        )}
                    </p>
                )}
            </div>
        </div>
    );
});

/** One staff credit: portrait, name, role. */
export const StaffRow = memo(function StaffRow({ staffRole }) {
    const className = 'group flex h-[60px] items-center gap-3';
    const content = (
        <>
            <PersonPortrait entity={staffRole.staff} />
            <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-[15px] font-medium text-[var(--text-1)] group-hover:text-[var(--signature)]">
                    {displayPersonName(staffRole.staff.name)}
                </p>
                {staffRole.role && <p className="line-clamp-1 text-sm text-[var(--text-3)]">{roleToSentence(staffRole.role)}</p>}
            </div>
        </>
    );

    return staffRole.staff?.id ? (
        <Link to={`/staff/${staffRole.staff.id}`} className={className}>{content}</Link>
    ) : (
        <div className={className}>{content}</div>
    );
});
