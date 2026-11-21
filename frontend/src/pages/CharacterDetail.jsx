import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { characterFavoriteApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import SEO from '../components/SEO';
import EntityFavoriteButton from '../components/common/EntityFavoriteButton';
import { characterKeys, characterQueries } from '../api/queries/anime';
import { characterFavoriteKeys } from '../api/queries/user';
import { groupRolesByAnime, markupToPlainText, toSafeHttpUrl } from '../utils/characterRoles';
import { SITE_ORIGIN, absoluteMediaUrl } from '../utils/imageUtils';
import PersonHeader, { BackButton, PersonNotFound, PersonPageSkeleton } from '../components/people/PersonHeader';
import { PeopleLinks, RoleList, RoleRow, ShowAllButton, roleLabel } from '../components/people/RoleRows';

// Prolific characters can have hundreds of appearances; show this many first.
const INITIAL_APPEARANCES = 60;

function Spoiler({ children }) {
    const [revealed, setRevealed] = useState(false);

    if (revealed) {
        return <span className="rounded bg-white/[0.06] px-1 text-[var(--text-1)]">{children}</span>;
    }

    return (
        <button
            type="button"
            onClick={() => setRevealed(true)}
            className="inline-flex cursor-pointer items-center rounded-[var(--radius-sm)] bg-white/[0.07] px-2 py-0.5 text-xs text-[var(--text-2)] transition-colors duration-150 hover:bg-white/[0.1] hover:text-[var(--text-1)]"
        >
            Spoiler
        </button>
    );
}

function parseInlineMarkdown(text, keyPrefix = '') {
    const parts = text.split(/(\[.*?\]\(.*?\)|\*\*.+?\*\*|__.+?__|_.+?_|\*.+?\*)/g);

    return parts.map((part, index) => {
        const key = `${keyPrefix}-${index}`;
        const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
        if (linkMatch) {
            const [, linkText, url] = linkMatch;
            const href = toSafeHttpUrl(url);
            if (!href) return <span key={key}>{linkText}</span>;
            return (
                <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                >
                    {linkText}
                </a>
            );
        }

        const boldMatch = part.match(/\*\*(.+?)\*\*|__(.+?)__/);
        if (boldMatch) {
            return <span key={key} className="font-semibold text-[var(--text-1)]">{boldMatch[1] || boldMatch[2]}</span>;
        }

        const italicMatch = part.match(/\*(.+?)\*|_(.+?)_/);
        if (italicMatch) {
            return <span key={key} className="italic text-[var(--text-1)]">{italicMatch[1] || italicMatch[2]}</span>;
        }

        return <span key={key}>{part}</span>;
    });
}

function parseMarkdownText(text) {
    if (!text) return null;

    const cleanText = text.replace(/<[^>]*>/g, '');
    const paragraphs = cleanText.split(/\n+/).filter((paragraph) => paragraph.trim());

    return paragraphs.map((paragraph, paragraphIndex) => {
        const spoilerParts = paragraph.split(/(~!.+?!~)/g);

        return (
            <p key={paragraphIndex} className="mb-3 last:mb-0">
                {spoilerParts.map((part, spoilerIndex) => {
                    const spoilerMatch = part.match(/~!(.+?)!~/);
                    if (spoilerMatch) {
                        return (
                            <Spoiler key={`spoiler-${paragraphIndex}-${spoilerIndex}`}>
                                {parseInlineMarkdown(spoilerMatch[1], `spoiler-text-${paragraphIndex}-${spoilerIndex}`)}
                            </Spoiler>
                        );
                    }

                    return parseInlineMarkdown(part, `text-${paragraphIndex}-${spoilerIndex}`);
                })}
            </p>
        );
    });
}

export default function CharacterDetail() {
    const { id } = useParams();
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const [favoriteState, setFavoriteState] = useState({ isFavorite: false, favoriteCount: 0 });
    // Which character the full list is open for (resets on navigation).
    const [showAllFor, setShowAllFor] = useState(null);
    const showAllAppearances = showAllFor === id;

    const { data: character, isLoading, error } = useQuery({
        ...characterQueries.detail(id),
        staleTime: 1000 * 60 * 10,
    });

    useEffect(() => {
        setFavoriteState({
            isFavorite: Boolean(character?.is_favorite),
            favoriteCount: character?.favorite_count || 0,
        });
    }, [character?.favorite_count, character?.is_favorite]);

    const toggleFavoriteMutation = useMutation({
        mutationFn: () => characterFavoriteApi.toggle(character.id),
        onSuccess: (response) => {
            setFavoriteState({
                isFavorite: response.data.is_favorite,
                favoriteCount: response.data.favorite_count ?? 0,
            });
            queryClient.invalidateQueries({ queryKey: characterKeys.detail(id) });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: characterFavoriteKeys.byUser(user.username) });
            }
        },
    });

    const parsedDescription = useMemo(
        () => parseMarkdownText(character?.description),
        [character?.description]
    );

    // One entry per anime, with all of its voice actors.
    const appearances = useMemo(
        () => groupRolesByAnime(character?.anime_roles, { personField: 'voice_actor' }),
        [character?.anime_roles]
    );

    if (isLoading) return <PersonPageSkeleton />;

    if (error || !character) {
        return (
            <>
                <SEO page="notFound" noIndex />
                <PersonNotFound what="character" />
            </>
        );
    }

    const appearanceCount = appearances.length;
    const visibleAppearances = showAllAppearances
        ? appearances
        : appearances.slice(0, INITIAL_APPEARANCES);
    const descriptionText = markupToPlainText(character.description, 120);

    return (
        <>
            <SEO
                customTitle={`${character.name} | AniShows`}
                customDescription={`${character.name}: character profile.${descriptionText ? ` ${descriptionText}` : ''}`}
                canonical={`${SITE_ORIGIN}/character/${character.id ?? id}`}
                ogImage={absoluteMediaUrl(character.image) || undefined}
                ogType="profile"
            />

            <div className="page-container pt-6 pb-16 md:pt-10">
                <BackButton />

                <PersonHeader
                    image={character.image}
                    name={character.name}
                    nativeName={character.name_native}
                    appearanceCount={appearanceCount}
                    action={(
                        <EntityFavoriteButton
                            isAuthenticated={isAuthenticated}
                            isFavorite={favoriteState.isFavorite}
                            favoriteCount={favoriteState.favoriteCount}
                            isPending={toggleFavoriteMutation.isPending}
                            onToggle={() => toggleFavoriteMutation.mutate()}
                            entityLabel={character.name}
                        />
                    )}
                >
                    {character.description ? parsedDescription : null}
                </PersonHeader>

                <section className="mt-12" aria-labelledby="character-appearances">
                    <h2 id="character-appearances" className="section-title mb-4">Anime appearances</h2>

                    {appearanceCount === 0 ? (
                        <p className="text-sm text-[var(--text-2)]">No anime appearances listed yet.</p>
                    ) : (
                        <>
                            <RoleList>
                                {visibleAppearances.map((appearance) => (
                                    <RoleRow
                                        key={appearance.key}
                                        anime={appearance.anime}
                                        meta={appearance.roles.map(roleLabel).join(' · ')}
                                    >
                                        <PeopleLinks people={appearance.people} pathFor={(voiceActor) => `/staff/${voiceActor.id}`} />
                                    </RoleRow>
                                ))}
                            </RoleList>
                            {!showAllAppearances && appearanceCount > INITIAL_APPEARANCES && (
                                <ShowAllButton total={appearanceCount} onClick={() => setShowAllFor(id)} />
                            )}
                        </>
                    )}
                </section>
            </div>
        </>
    );
}
