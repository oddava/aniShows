import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import { characterApi, characterFavoriteApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import EntityFavoriteButton from '../components/common/EntityFavoriteButton';
import AnimeMediaImage from '../components/common/AnimeMediaImage';

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
            const [, linkText] = linkMatch;
            return <span key={key}>{linkText}</span>;
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
                <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:gap-8">
                    <div className="mx-auto h-60 w-44 rounded-lg bg-dark-200 sm:mx-0" />
                    <div className="flex-1 space-y-3 pt-2">
                        <div className="h-8 w-64 rounded bg-dark-200" />
                        <div className="h-5 w-40 rounded bg-dark-200" />
                        <div className="h-10 w-64 rounded bg-dark-200" />
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


    const { data: character, isLoading, error } = useQuery({
        queryKey: ['character', id],
        queryFn: ({ signal }) => characterApi.getById(id, signal).then((res) => res.data),
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
            queryClient.invalidateQueries({ queryKey: ['character', id] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['character-favorites', user.username] });
            }
        },
    });

    const parsedDescription = useMemo(
        () => parseMarkdownText(character?.description),
        [character?.description]
    );

    if (isLoading) return <CharacterDetailSkeleton />;

    if (error || !character) {
        return (
            <div className="min-h-screen bg-dark flex items-center justify-center">
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

    const appearanceCount = character.anime_roles?.length || 0;

    return (
        <>
            <Helmet>
                <title>{character.name} - aniShows</title>
                <meta
                    name="description"
                    content={`${character.name} - character profile. ${character.description?.slice(0, 120) || ''}`}
                />
            </Helmet>

            <div className="min-h-screen bg-dark">
                <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
                    <button
                        type="button"
                        onClick={() => window.history.back()}
                        className="mb-6 inline-block text-sm font-medium text-gray-400 transition-colors hover:text-white sm:mb-8"
                    >
                        Back
                    </button>

                    <div className="mb-8 flex flex-col gap-6 sm:mb-10 sm:flex-row sm:gap-8">
                        <div className="mx-auto flex-shrink-0 sm:mx-0">
                            <div className="h-60 w-44 overflow-hidden rounded-lg bg-dark-200">
                                <img
                                    src={character.image || '/placeholder-avatar.png'}
                                    alt={character.name}
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            {character.anilist_id && (
                                <a
                                    href={`https://anilist.co/character/${character.anilist_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 block text-center text-xs font-medium text-gray-500 transition-colors hover:text-gray-300"
                                >
                                    AniList
                                </a>
                            )}
                        </div>

                        <div className="flex-1 pt-1 pb-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="text-center sm:text-left">
                                    <h1 className="mb-1 text-2xl font-black text-white sm:text-3xl">
                                        {character.name}
                                    </h1>
                                    {character.name_native && (
                                        <p className="mb-3 text-base text-gray-400 sm:text-lg">
                                            {character.name_native}
                                        </p>
                                    )}

                                    {appearanceCount > 0 && (
                                        <div className="mb-4">
                                            <span className="text-sm font-medium text-gray-400">
                                                {appearanceCount} {appearanceCount === 1 ? 'Appearance' : 'Appearances'}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-center sm:justify-end">
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
                                <div className="max-w-3xl text-sm leading-relaxed text-gray-300">
                                    {parsedDescription}
                                </div>
                            )}
                        </div>
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
                            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                                {character.anime_roles.map((role) => (
                                    <div
                                        key={role.id}
                                        className="group flex gap-4 py-3 transition-colors"
                                    >
                                        <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-dark-200">
                                            <Link to={`/anime/${role.anime?.slug}`} className="block h-full w-full">
                                                <AnimeMediaImage
                                                    anime={role.anime}
                                                    kind="cover"
                                                    size="small"
                                                    alt={role.anime?.title}
                                                    className="h-full w-full object-cover transition-opacity hover:opacity-80"
                                                />
                                            </Link>
                                        </div>
                                        <div className="min-w-0 flex-1 flex flex-col justify-center">
                                            <Link
                                                to={`/anime/${role.anime?.slug}`}
                                                className="truncate text-sm font-medium text-gray-200 transition-colors hover:text-white"
                                            >
                                                {role.anime?.title}
                                            </Link>
                                            <p className="mt-0.5 text-xs text-gray-500">
                                                {role.role}
                                            </p>
                                            {role.voice_actor ? (
                                                <div className="mt-1.5">
                                                    <Link
                                                        to={`/staff/${role.voice_actor.id}`}
                                                        onClick={(event) => event.stopPropagation()}
                                                        className="truncate block text-xs text-gray-400 transition-colors hover:text-gray-300"
                                                    >
                                                        {role.voice_actor.name}
                                                    </Link>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </>
    );
}
