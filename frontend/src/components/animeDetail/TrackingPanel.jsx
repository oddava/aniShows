import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Pencil, Plus, RotateCcw, Star } from 'lucide-react';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { LIST_STATUSES } from '../../utils/listStatus';
import { airedEpisodeCount, knownEpisodeTotal } from '../../utils/episodes';
import QuickAdd from '../ui/QuickAdd';
import ProgressStepper from '../ui/ProgressStepper';
import ScorePicker from '../ui/ScorePicker';
import ListEntryEditModal from '../ListEntryEditModal';

const MODAL_STATUS_OPTIONS = LIST_STATUSES.map(({ value, label }) => ({ value, label }));

/**
 * Tracking on the detail page: status (fixed colours, V1), favourite, the
 * progress stepper, and your score, visible and tappable (T5). The edit
 * modal is only for dates, notes and rewatches.
 */
export default function TrackingPanel({
    anime,
    isAuthenticated,
    isFavorite,
    onFavorite,
    onListUpdate,
    compact = false,
}) {
    const {
        entry, setStatus, setScore, setProgress, save, remove, startRewatch, isPending,
    } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count, next_airing_episode: anime.next_airing_episode, next_airing_date: anime.next_airing_date },
        entry: anime.user_list_status,
    });
    const [scoreOpen, setScoreOpen] = useState(false);
    // Taps the stepper has not written yet (it batches them): the editor
    // opens on this value, so its Save never undoes a +1.
    const [stepperDraft, setStepperDraft] = useState(null);
    const [editOpen, setEditOpen] = useState(false);

    const status = entry.status;
    const inList = Boolean(entry.id || status);
    const total = knownEpisodeTotal(anime);
    const aired = airedEpisodeCount(anime);
    const stillAiring = Boolean(anime.next_airing_date) || anime.status === 'Airing';
    const canRewatch = !stillAiring && (!total || (entry.episodes_watched || 0) >= total);

    // Right after Completed with no score: offer the score row (skippable).
    const [justCompleted, setJustCompleted] = useState(false);
    useEffect(() => {
        // Scored, or no longer Completed (Keep watching, Undo): the prompt goes.
        if (entry.score > 0 || entry.status !== 'Completed') setJustCompleted(false);
    }, [entry.score, entry.status]);

    if (!isAuthenticated) {
        return (
            <Link to="/login" className="btn-primary w-full">
                <Plus aria-hidden="true" className="h-4 w-4" />
                Sign in to track
            </Link>
        );
    }

    const report = (saved) => {
        if (saved) onListUpdate?.(saved.id ? saved : null);
        return saved;
    };

    // The score prompt after Completed opens in place (not as a second
    // popover): the stepper above it stays visible, showing where you stopped.
    const handleStatus = async (value) => {
        if (value === 'Completed' && !entry.score) setJustCompleted(true);
        const saved = report(await setStatus(value));
        if (!saved || saved.status !== 'Completed') setJustCompleted(false);
    };

    const handleScore = async (value) => {
        report(await setScore(value));
        setScoreOpen(false);
        setJustCompleted(false);
    };

    const showScoreRow = scoreOpen || justCompleted;
    const iconButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-white/[0.07] text-gray-300 transition-colors hover:bg-white/[0.11] hover:text-white';

    return (
        <div className="space-y-2.5" data-title="Tracking">
            <div className="relative flex items-stretch gap-2">
                <QuickAdd
                    variant="button"
                    placement="down"
                    className="min-w-0 flex-1"
                    status={status}
                    score={entry.score}
                    watched={entry.episodes_watched || 0}
                    total={Number(anime.episode_count) > 0 ? Number(anime.episode_count) : null}
                    aired={airedEpisodeCount(anime)}
                    title={anime.title}
                    pending={isPending}
                    onSelect={handleStatus}
                    onRemove={async () => report(await remove())}
                />
                <button
                    type="button"
                    onClick={onFavorite}
                    aria-pressed={Boolean(isFavorite)}
                    aria-label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                    title={isFavorite ? 'In your favourites' : 'Add to favourites'}
                    className={`${iconButton} ${isFavorite ? '!text-[var(--status-dropped)]' : ''}`}
                >
                    <Heart aria-hidden="true" className={`h-[18px] w-[18px] ${isFavorite ? 'fill-current' : ''}`} />
                </button>
                {inList && (
                    <button
                        type="button"
                        onClick={() => setEditOpen(true)}
                        aria-label="Edit dates, notes and rewatches"
                        title="Dates, notes, rewatches"
                        className={iconButton}
                    >
                        <Pencil aria-hidden="true" className="h-[18px] w-[18px]" />
                    </button>
                )}
            </div>

            {inList && status !== 'Plan to Watch' && (
                <ProgressStepper
                    className="flex w-full justify-between"
                    value={entry.episodes_watched || 0}
                    total={total}
                    aired={aired}
                    title={anime.title}
                    onCommit={async (next) => report(await setProgress(next))}
                    onDraft={setStepperDraft}
                />
            )}

            {inList && (
                <div className="rounded-[var(--radius-md)] bg-white/[0.035]">
                    <button
                        type="button"
                        onClick={() => {
                            setScoreOpen((open) => !open);
                            setJustCompleted(false);
                        }}
                        aria-expanded={showScoreRow}
                        className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-sm"
                    >
                        <span className="text-gray-400">Your score</span>
                        <span className="ml-auto flex items-center gap-1.5 font-semibold tabular">
                            {entry.score > 0 ? (
                                <>
                                    <Star aria-hidden="true" className="h-4 w-4 fill-[var(--status-on-hold)] text-[var(--status-on-hold)]" />
                                    <span className="text-white text-base" key={entry.score}>{entry.score}</span>
                                    <span className="text-gray-500 font-normal">/ 10</span>
                                </>
                            ) : (
                                <span className="text-[var(--signature)]">Rate it</span>
                            )}
                        </span>
                    </button>
                    {showScoreRow && (
                        <div className="px-2 pb-2">
                            {justCompleted && (
                                <p className="px-1.5 pb-2 text-xs text-gray-400">Finished? Score it in one tap, or skip.</p>
                            )}
                            <ScorePicker
                                value={entry.score}
                                onChange={handleScore}
                                size="sm"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Rewatch only once every episode is out and watched. */}
            {status === 'Completed' && !entry.is_rewatching && canRewatch && (
                <button
                    type="button"
                    onClick={async () => report(await startRewatch())}
                    className="btn-ghost w-full justify-start text-sm"
                >
                    <RotateCcw aria-hidden="true" className="h-4 w-4" />
                    Rewatch
                </button>
            )}

            <ListEntryEditModal
                isOpen={editOpen}
                onClose={() => setEditOpen(false)}
                onSave={async (payload) => {
                    const saved = report(await save(payload));
                    if (saved) setEditOpen(false);
                    return saved;
                }}
                initialEntry={{ status: 'Plan to Watch', ...entry, episodes_watched: stepperDraft ?? entry.episodes_watched }}
                totalEpisodes={anime.episode_count}
                airedEpisodes={aired}
                statusOptions={MODAL_STATUS_OPTIONS}
                isSaving={isPending}
                animeTitle={anime.title}
            />
        </div>
    );
}
