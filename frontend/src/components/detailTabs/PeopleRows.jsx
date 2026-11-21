import { memo } from 'react';
import { Link } from 'react-router-dom';
import Portrait from '../ui/Portrait';
import { getPortraitSrcSet, getPortraitUrl } from './portraits';
import { capsToSentence } from './format';

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
 * One character and their voice actor in a row: character left,
 * voice actor right (like oddava.me's list with the year on the right).
 */
export const CharacterRow = memo(function CharacterRow({ role }) {
    const characterHref = `/character/${role.character.id}`;
    const actor = role.voice_actor;

    return (
        <div className="flex h-[60px] items-center gap-3">
            <Link to={characterHref} tabIndex={-1} aria-hidden="true" className="flex-shrink-0">
                <PersonPortrait entity={role.character} />
            </Link>
            <div className="min-w-0 flex-1">
                <Link to={characterHref} className="line-clamp-1 text-[15px] font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                    {role.character.name}
                </Link>
                {role.role && <p className="text-sm text-[var(--text-3)]">{capsToSentence(role.role)}</p>}
            </div>
            {actor && (
                <>
                    <div className="min-w-0 flex-1 text-right">
                        <Link to={`/staff/${actor.id}`} className="line-clamp-1 text-[15px] text-[var(--text-2)] hover:text-[var(--signature)]">
                            {actor.name}
                        </Link>
                        <p className="text-sm text-[var(--text-3)]">Japanese</p>
                    </div>
                    <Link to={`/staff/${actor.id}`} tabIndex={-1} aria-hidden="true" className="flex-shrink-0">
                        <PersonPortrait entity={actor} />
                    </Link>
                </>
            )}
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
                    {staffRole.staff.name}
                </p>
                {staffRole.role && <p className="line-clamp-1 text-sm text-[var(--text-3)]">{staffRole.role}</p>}
            </div>
        </>
    );

    return staffRole.staff?.id ? (
        <Link to={`/staff/${staffRole.staff.id}`} className={className}>{content}</Link>
    ) : (
        <div className={className}>{content}</div>
    );
});
