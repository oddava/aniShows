import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { staffFavoriteApi } from '../api/client';
import SEO from '../components/SEO';
import EntityFavoriteButton from '../components/common/EntityFavoriteButton';
import { useAuth } from '../context/AuthContext';
import { staffKeys, staffQueries } from '../api/queries/anime';
import { staffFavoriteKeys } from '../api/queries/user';
import { groupRolesByAnime, markupToPlainText, toSafeHttpUrl } from '../utils/characterRoles';
import { SITE_ORIGIN, absoluteMediaUrl } from '../utils/imageUtils';
import PersonHeader, { BackButton, PersonNotFound, PersonPageSkeleton } from '../components/people/PersonHeader';
import { PeopleLinks, RoleList, RoleRow, ShowAllButton, roleLabel } from '../components/people/RoleRows';

// A prolific voice actor can have hundreds of roles; show this many first.
const INITIAL_ROLES = 60;

// Parse markdown-style links [text](url) into React elements. Only http(s)
// links become anchors; any other scheme stays plain text.
function parseMarkdownLinks(text) {
    if (!text) return null;
    const parts = text.split(/(\[.*?\]\(.*?\))/g);
    return parts.map((part, index) => {
        const match = part.match(/\[(.*?)\]\((.*?)\)/);
        if (match) {
            const [, linkText, url] = match;
            const href = toSafeHttpUrl(url);
            if (!href) return <span key={index}>{linkText.replace(/<[^>]*>/g, '')}</span>;
            return (
                <a
                    key={index}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                    onClick={(e) => e.stopPropagation()}
                >
                    {linkText}
                </a>
            );
        }
        return <span key={index}>{part.replace(/<[^>]*>/g, '')}</span>;
    });
}

export default function VoiceActorDetail() {
    const { id } = useParams();
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const [favoriteState, setFavoriteState] = useState({ isFavorite: false, favoriteCount: 0 });

    const { data: staff, isLoading, error } = useQuery({
        ...staffQueries.detail(id),
        staleTime: 1000 * 60 * 10,
    });

    const parsedDescription = useMemo(() => {
        if (!staff?.description) return null;
        return staff.description.split('\n').filter(p => !!p.trim()).map((para, i) => (
            <p key={i} className="mb-4 last:mb-0">
                {parseMarkdownLinks(para)}
            </p>
        ));
    }, [staff?.description]);

    useEffect(() => {
        setFavoriteState({
            isFavorite: Boolean(staff?.is_favorite),
            favoriteCount: staff?.favorite_count || 0,
        });
    }, [staff?.favorite_count, staff?.is_favorite]);

    const toggleFavoriteMutation = useMutation({
        mutationFn: () => staffFavoriteApi.toggle(staff.id),
        onSuccess: (response) => {
            setFavoriteState({
                isFavorite: response.data.is_favorite,
                favoriteCount: response.data.favorite_count ?? 0,
            });
            queryClient.invalidateQueries({ queryKey: staffKeys.detail(id) });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: staffFavoriteKeys.byUser(user.username) });
            }
        },
    });

    // One entry per anime: its characters (voice roles) or job titles (credits).
    const voiceRoles = useMemo(
        () => groupRolesByAnime(staff?.voice_roles, { personField: 'character' }),
        [staff?.voice_roles]
    );
    const productionCredits = useMemo(
        () => groupRolesByAnime(staff?.production_credits),
        [staff?.production_credits]
    );
    const voiceRoleCount = voiceRoles.length;
    const productionCreditCount = productionCredits.length;

    if (isLoading) return <PersonPageSkeleton />;

    if (error || !staff) {
        return (
            <>
                <SEO page="notFound" noIndex />
                <PersonNotFound what="person" />
            </>
        );
    }

    const appearanceCount = voiceRoleCount + productionCreditCount;
    const descriptionText = markupToPlainText(staff.description, 120);

    return (
        <>
            <SEO
                customTitle={`${staff.name} | AniShows`}
                customDescription={`${staff.name}: voice actor and staff profile.${descriptionText ? ` ${descriptionText}` : ''}`}
                canonical={`${SITE_ORIGIN}/staff/${staff.id ?? id}`}
                ogImage={absoluteMediaUrl(staff.image) || undefined}
                ogType="profile"
            />

            <div className="page-container pt-6 pb-16 md:pt-10">
                <BackButton />

                <PersonHeader
                    image={staff.image}
                    name={staff.name}
                    nativeName={staff.name_native}
                    appearanceCount={appearanceCount}
                    action={(
                        <EntityFavoriteButton
                            isAuthenticated={isAuthenticated}
                            isFavorite={favoriteState.isFavorite}
                            favoriteCount={favoriteState.favoriteCount}
                            isPending={toggleFavoriteMutation.isPending}
                            onToggle={() => toggleFavoriteMutation.mutate()}
                            entityLabel={staff.name}
                        />
                    )}
                    aside={staff.anilist_id ? (
                        <a
                            href={`https://anilist.co/staff/${staff.anilist_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-link mt-1 w-full justify-center text-sm"
                        >
                            AniList
                        </a>
                    ) : null}
                >
                    {staff.description ? parsedDescription : null}
                </PersonHeader>

                {voiceRoleCount > 0 && (
                    <section className="mt-12" aria-labelledby="staff-voice-roles">
                        <h2 id="staff-voice-roles" className="section-title mb-4">Voice roles</h2>
                        <VoiceRolesSection key={staff.id ?? id} voiceRoles={voiceRoles} />
                    </section>
                )}

                {productionCreditCount > 0 && (
                    <section className="mt-12" aria-labelledby="staff-credits">
                        <h2 id="staff-credits" className="section-title mb-4">Production credits</h2>
                        <ProductionCreditsSection key={staff.id ?? id} credits={productionCredits} />
                    </section>
                )}

                {appearanceCount === 0 && (
                    <p className="mt-12 text-sm text-[var(--text-2)]">No roles or credits listed yet.</p>
                )}
            </div>
        </>
    );
}

function useShowAll(items) {
    const [showAll, setShowAll] = useState(false);
    const visible = showAll ? items : items.slice(0, INITIAL_ROLES);
    const canShowAll = !showAll && items.length > INITIAL_ROLES;
    return { visible, canShowAll, showAll: () => setShowAll(true) };
}

function VoiceRolesSection({ voiceRoles }) {
    const { visible, canShowAll, showAll } = useShowAll(voiceRoles);

    return (
        <>
            <RoleList>
                {visible.map((group) => (
                    <RoleRow key={group.key} anime={group.anime} meta={group.roles.map(roleLabel).join(' · ')}>
                        <PeopleLinks people={group.people} pathFor={(character) => `/character/${character.id}`} />
                    </RoleRow>
                ))}
            </RoleList>
            {canShowAll && <ShowAllButton total={voiceRoles.length} onClick={showAll} />}
        </>
    );
}

function ProductionCreditsSection({ credits }) {
    const { visible, canShowAll, showAll } = useShowAll(credits);

    return (
        <>
            <RoleList>
                {visible.map((group) => (
                    <RoleRow key={group.key} anime={group.anime}>
                        <p className="line-clamp-2">{group.roles.map(roleLabel).join(', ')}</p>
                    </RoleRow>
                ))}
            </RoleList>
            {canShowAll && <ShowAllButton total={credits.length} onClick={showAll} />}
        </>
    );
}
