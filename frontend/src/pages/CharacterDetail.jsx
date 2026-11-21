import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { characterFavoriteApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import SEO from '../components/SEO';
import EntityFavoriteButton from '../components/common/EntityFavoriteButton';
import AnimeMediaImage from '../components/common/AnimeMediaImage';
import { characterKeys, characterQueries } from '../api/queries/anime';
import { characterFavoriteKeys } from '../api/queries/user';
import { groupRolesByAnime, markupToPlainText, toSafeHttpUrl } from '../utils/characterRoles';
import { SITE_ORIGIN, absoluteMediaUrl } from '../utils/imageUtils';
import Portrait from '../components/ui/Portrait';

// Prolific characters can have hundreds of appearances; show this many first.
const INITIAL_APPEARANCES = 60;

function Spoiler({ children }) {
    const [revealed, setRevealed] = useState(false);

    if (revealed) {
        return <span className="rounded bg-yellow-500/20 px-1">{children}</span>;
    }

    return (
        <button
            type="button"
            onClick={() => setRevealed(true)}
            className="inline-flex cursor-pointer items-center gap-1 rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
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
                    className="text-blue-400 hover:text-blue-300 underline transition-colors"
                >
                    {linkText}
                </a>
            );
        }

        const boldMatch = part.match(/\*\*(.+?)\*\*|__(.+?)__/);
        if (boldMatch) {
            return <span key={key} className="font-bold text-gray-200">{boldMatch[1] || boldMatch[2]}</span>;
        }

        const italicMatch = part.match(/\*(.+?)\*|_(.+?)_/);
        if (italicMatch) {
            return <span key={key} className="italic text-gray-200">{italicMatch[1] || italicMatch[2]}</span>;
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

function CharacterDetailSkeleton() {
    return (
        <div className="min-h-screen bg-dark animate-pulse">
            <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
                <div className="mb-8 h-5 w-24 rounded bg-dark-200" />
                <div className="mb-10 grid grid-cols-[112px_1fr] sm:grid-cols-[176px_1fr] gap-x-4 sm:gap-x-8 gap-y-6">
                    <div className="col-start-1 row-start-1 sm:row-span-2 h-40 w-28 sm:h-60 sm:w-44 rounded-lg bg-dark-200 mx-auto sm:mx-0" />
                    <div className="col-start-2 row-start-1 flex flex-row items-start justify-between gap-3 sm:gap-4 pt-2">
                        <div className="space-y-3 flex-1 min-w-0">
                            <div className="h-6 sm:h-8 w-full max-w-[16rem] rounded bg-dark-200" />
                            <div className="h-4 sm:h-5 w-24 sm:w-40 rounded bg-dark-200" />
                            <div className="h-4 w-20 sm:w-32 rounded bg-dark-200 mt-4" />
                        </div>
                        <div className="h-9 sm:h-10 w-16 sm:w-20 rounded-xl bg-dark-200 flex-shrink-0" />
                    </div>
                    <div className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 space-y-3">
                        <div className="h-4 w-full rounded bg-dark-200" />
                        <div className="h-4 w-5/6 rounded bg-dark-200" />
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-20 rounded-lg bg-dark-200" />
                    ))}
                </div>
            </div>
        </div>
    );
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

    if (isLoading) return <CharacterDetailSkeleton />;

    if (error || !character) {
        return (
            <div className="min-h-screen bg-dark flex items-center justify-center">
                <SEO page="notFound" noIndex />
                <div className="text-center">
                    <h2 className="mb-2 text-xl font-bold text-white">Character Not Found</h2>
                    <p className="mb-6 text-gray-400">The character you&apos;re looking for doesn&apos;t exist.</p>
                    <Link to="/" className="font-medium text-accent transition-colors hover:text-accent/80">
                        Go Home
                    </Link>
                </div>
            </div>
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

            <div className="min-h-screen bg-dark">
                <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
                    <button
                        type="button"
                        onClick={() => window.history.back()}
                        className="mb-6 inline-block text-sm font-medium text-gray-400 transition-colors hover:text-white sm:mb-8"
                    >
                        Back
                    </button>

                    <div className="mb-8 grid grid-cols-[112px_1fr] sm:grid-cols-[176px_1fr] gap-x-4 sm:gap-x-8 gap-y-6 sm:mb-10">
                        <div className="col-start-1 row-start-1 sm:row-span-2 mx-auto sm:mx-0">
                            <div className="h-40 w-28 sm:h-60 sm:w-44 overflow-hidden rounded-lg bg-dark-200">
                                <Portrait src={character.image} alt={character.name} sizes="176px" loading="eager" className="h-full w-full" />
                            </div>
                        </div>

                        <div className="col-start-2 row-start-1 flex flex-row items-start justify-between gap-3 sm:gap-4 pt-1">
                            <div className="text-left min-w-0">
                                <h1 className="mb-1 text-xl font-black text-white sm:text-3xl break-words">
                                    {character.name}
                                </h1>
                                {character.name_native && (
                                    <p className="mb-3 text-sm text-gray-400 sm:text-lg break-words">
                                        {character.name_native}
                                    </p>
                                )}

                                {appearanceCount > 0 && (
                                    <div className="mb-4">
                                        <span className="text-xs sm:text-sm font-medium text-gray-400">
                                            {appearanceCount} {appearanceCount === 1 ? 'Appearance' : 'Appearances'}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-shrink-0">
                                <EntityFavoriteButton
                                    isAuthenticated={isAuthenticated}
                                    isFavorite={favoriteState.isFavorite}
                                    favoriteCount={favoriteState.favoriteCount}
                                    isPending={toggleFavoriteMutation.isPending}
                                    onToggle={() => toggleFavoriteMutation.mutate()}
                                    entityLabel="Character"
                                />
                            </div>
                        </div>

                        {character.description && (
                            <div className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 max-w-3xl text-sm leading-relaxed text-gray-200 font-medium">
                                {parsedDescription}
                            </div>
                        )}
                    </div>

                    <section>
                        <div className="mb-5">
                            <h2 className="text-lg font-medium text-white sm:text-xl">Anime Appearances</h2>
                        </div>

                        {appearanceCount === 0 ? (
                            <div className="py-12 text-center">
                                <p className="text-sm text-gray-400">No anime appearances available.</p>
                            </div>
                        ) : (
                            <>
                            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                                {visibleAppearances.map((appearance) => (
                                    <div
                                        key={appearance.key}
                                        className="group flex gap-4 py-3 transition-colors"
                                    >
                                        <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-dark-200">
                                            <Link to={`/anime/${appearance.anime?.slug}`} className="block h-full w-full">
                                                <AnimeMediaImage
                                                    anime={appearance.anime}
                                                    kind="cover"
                                                    size="small"
                                                    alt={appearance.anime?.title}
                                                    className="h-full w-full object-cover transition-opacity hover:opacity-80"
                                                    loading="lazy"
                                                />
                                            </Link>
                                        </div>
                                        <div className="min-w-0 flex-1 flex flex-col justify-center">
                                            <Link
                                                to={`/anime/${appearance.anime?.slug}`}
                                                className="truncate text-sm font-medium text-gray-200 transition-colors hover:text-white"
                                            >
                                                {appearance.anime?.title}
                                            </Link>
                                            <p className="mt-0.5 text-xs text-gray-500">
                                                {appearance.roles.join(' · ')}
                                            </p>
                                            {appearance.people.length > 0 ? (
                                                <p className="mt-1.5 text-xs text-gray-400 line-clamp-2">
                                                    {appearance.people.map((voiceActor, index) => (
                                                        <span key={voiceActor.id ?? voiceActor.name}>
                                                            {index > 0 && ', '}
                                                            <Link
                                                                to={`/staff/${voiceActor.id}`}
                                                                className="transition-colors hover:text-gray-300"
                                                            >
                                                                {voiceActor.name}
                                                            </Link>
                                                        </span>
                                                    ))}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {!showAllAppearances && appearanceCount > INITIAL_APPEARANCES && (
                                <div className="mt-6 text-center">
                                    <button
                                        type="button"
                                        onClick={() => setShowAllFor(id)}
                                        className="btn-secondary text-sm"
                                    >
                                        Show all {appearanceCount}
                                    </button>
                                </div>
                            )}
                            </>
                        )}
                    </section>
                </div>
            </div>
        </>
    );
}
