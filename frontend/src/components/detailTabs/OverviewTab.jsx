import { useMemo } from 'react';
import FranchiseSection from '../FranchiseSection';
import MusicSection from '../MusicSection';
import LazyYouTube from '../LazyYouTube';
import { getUniqueCharacterRoles } from '../../utils/characterRoles';
import { meaningfulEpisodeTitle } from './format';
import { CharacterRow, StaffRow } from './PeopleRows';

const getYouTubeId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
    return match ? match[1] : null;
};

function Section({ title, children }) {
    return (
        <section className="min-w-0">
            <h2 className="section-title mb-5">{title}</h2>
            {children}
        </section>
    );
}

/**
 * Overview, most useful first: who's in it, what comes before and after,
 * the episodes (only when they say more than "Episode 1"), the trailer, the
 * music, then the crew. Score and key facts live in the page head; the
 * status distribution lives on the Stats tab.
 */
export default function OverviewTab({ anime, accentColor, characters, staff, episodes }) {
    const videoId = getYouTubeId(anime.trailer_url);
    const hasThemes = anime?.theme_songs && anime.theme_songs.some((t) => t.song_type === 'opening' || t.song_type === 'ending');

    const topStaff = useMemo(() => {
        if (!Array.isArray(staff)) return [];
        const seen = new Set();
        return staff
            .filter((s) => {
                const name = s?.staff?.name;
                if (!name || seen.has(name)) return false;
                seen.add(name);
                return true;
            })
            .slice(0, 4);
    }, [staff]);

    const topCharacters = useMemo(() => {
        return getUniqueCharacterRoles(characters, { includeVoiceActor: false }).slice(0, 4);
    }, [characters]);

    // A preview of "Episode 1 … Episode 4" tells nobody anything; show it only
    // when the episodes have titles or stills. The Watch tab has the full list.
    const topEpisodes = useMemo(() => {
        if (!Array.isArray(episodes)) return [];
        const preview = episodes.slice(0, 4);
        return preview.some((e) => e.thumbnail || meaningfulEpisodeTitle(e)) ? preview : [];
    }, [episodes]);

    return (
        <div className="animate-tab-content space-y-16">
            {topCharacters.length > 0 && (
                <Section title="Characters">
                    <div className="grid grid-cols-1 gap-x-10 gap-y-6 xl:grid-cols-2">
                        {topCharacters.map((role) => (
                            <CharacterRow key={role.id} role={role} />
                        ))}
                    </div>
                </Section>
            )}

            <FranchiseSection relations={anime.relations} accentColor={accentColor} sourceSlug={anime.slug} />

            {topEpisodes.length > 0 && (
                <Section title="Episodes">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-6 xl:grid-cols-4">
                        {topEpisodes.map((episode) => {
                            const title = meaningfulEpisodeTitle(episode);
                            const Wrapper = episode.crunchyroll_url ? 'a' : 'div';
                            return (
                                <Wrapper
                                    key={episode.number}
                                    {...(episode.crunchyroll_url ? { href: episode.crunchyroll_url, target: '_blank', rel: 'noreferrer' } : {})}
                                    className="group block min-w-0"
                                >
                                    {episode.thumbnail && (
                                        <div className="relative mb-2 aspect-video overflow-hidden rounded-[var(--radius-md)] bg-[var(--ink-2)]">
                                            <img
                                                src={episode.thumbnail}
                                                alt=""
                                                loading="lazy"
                                                className="absolute inset-0 h-full w-full object-cover"
                                            />
                                        </div>
                                    )}
                                    <p className="text-sm text-[var(--text-3)] tabular">Episode {episode.number}</p>
                                    {title && (
                                        <p className="line-clamp-2 text-[15px] leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)]">{title}</p>
                                    )}
                                </Wrapper>
                            );
                        })}
                    </div>
                </Section>
            )}

            {videoId && (
                <Section title="Trailer">
                    <div className="max-w-3xl">
                        <LazyYouTube videoId={videoId} title="Trailer" accentColor={accentColor} />
                    </div>
                </Section>
            )}

            {hasThemes && <MusicSection anime={anime} accentColor={accentColor} isCompact={false} itemLimit={2} />}

            {topStaff.length > 0 && (
                <Section title="Staff">
                    <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
                        {topStaff.map((staffRole) => (
                            <StaffRow key={staffRole.id} staffRole={staffRole} />
                        ))}
                    </div>
                </Section>
            )}
        </div>
    );
}
