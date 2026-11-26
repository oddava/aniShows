import { formatDate, formatNumber } from '../../format';
import { Poster } from '../../ui';

const text = (value) => (value === null || value === undefined ? '' : String(value));
const orNull = (value) => (String(value ?? '').trim() === '' ? null : String(value).trim());
const intOrNull = (value) => (String(value ?? '').trim() === '' ? null : Number.parseInt(value, 10));
const muted = (value) => (value ? value : <span className="text-[var(--text-3)]">—</span>);

const countColumn = (header = 'Anime') => ({
    key: 'anime_count',
    header,
    align: 'right',
    width: '7rem',
    cell: (row) => formatNumber(row.anime_count ?? 0),
});

const nameCell = (row) => (
    <span className="block min-w-0">
        <span className="block truncate font-medium text-[var(--text-1)]">{row.name}</span>
    </span>
);

export const genreConfig = {
    resource: 'genres',
    entity: 'genre',
    modelLabel: 'anime.Genre',
    singular: 'genre',
    plural: 'genres',
    title: 'Genres',
    description: 'The genres anime are filed under on Browse and detail pages.',
    allowForce: true,
    publicHref: (row) => `/browse?genre=${encodeURIComponent(row.slug)}`,
    columns: [
        { key: 'name', header: 'Name', primary: true, cell: nameCell },
        { key: 'slug', header: 'Slug', cell: (row) => <span className="admin-mono text-[var(--text-2)]">{row.slug}</span> },
        {
            key: 'description',
            header: 'Description',
            hideOnPhone: true,
            cell: (row) => <span className="line-clamp-2 max-w-md text-[var(--text-2)]">{muted(row.description)}</span>,
        },
        countColumn(),
    ],
    fields: [
        { name: 'name', label: 'Name', required: true, placeholder: 'Action', maxLength: 50 },
        { name: 'slug', label: 'Slug', placeholder: 'action', hint: 'Used in links. Left empty, it is made from the name.', maxLength: 50 },
        { name: 'description', label: 'Description', type: 'textarea' },
    ],
    toForm: (row) => ({ name: text(row?.name), slug: text(row?.slug), description: text(row?.description) }),
    toPayload: (form) => ({ name: form.name.trim(), slug: form.slug.trim(), description: form.description.trim() }),
};

export const studioConfig = {
    resource: 'studios',
    entity: 'studio',
    modelLabel: 'anime.Studio',
    singular: 'studio',
    plural: 'studios',
    title: 'Studios',
    description: 'Animation studios credited on anime.',
    allowForce: true,
    columns: [
        { key: 'name', header: 'Name', primary: true, cell: nameCell },
        { key: 'founded', header: 'Founded', cell: (row) => muted(row.founded_date && formatDate(row.founded_date)) },
        {
            key: 'website',
            header: 'Website',
            hideOnPhone: true,
            cell: (row) => (row.website ? (
                <a href={row.website} target="_blank" rel="noopener noreferrer" className="block max-w-[16rem] truncate text-[var(--signature)] hover:text-[var(--signature-hover)]">
                    {row.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
            ) : muted(null)),
        },
        countColumn(),
    ],
    fields: [
        { name: 'name', label: 'Name', required: true, placeholder: 'Madhouse', maxLength: 100 },
        { name: 'founded_date', label: 'Founded', type: 'date' },
        { name: 'website', label: 'Website', type: 'url', placeholder: 'https://' },
    ],
    toForm: (row) => ({ name: text(row?.name), founded_date: text(row?.founded_date), website: text(row?.website) }),
    toPayload: (form) => ({ name: form.name.trim(), founded_date: orNull(form.founded_date), website: form.website.trim() }),
};

const personColumns = (countHeader) => [
    {
        key: 'name',
        header: 'Name',
        primary: true,
        sortKey: 'name',
        sortFirst: 'asc',
        cell: (row) => (
            <span className="flex min-w-0 items-center gap-3">
                <Poster src={row.image} size="xs" />
                <span className="min-w-0">
                    <span className="block truncate font-medium text-[var(--text-1)]">{row.name}</span>
                    {row.name_native && <span className="block truncate text-xs text-[var(--text-3)]">{row.name_native}</span>}
                </span>
            </span>
        ),
    },
    {
        key: 'anilist_id',
        header: 'AniList id',
        sortKey: 'anilist_id',
        cell: (row) => (row.anilist_id
            ? <a href={`https://anilist.co/${countHeader === 'Characters' ? 'character' : 'staff'}/${row.anilist_id}`} target="_blank" rel="noopener noreferrer" className="tabular text-[var(--signature)] hover:text-[var(--signature-hover)]">{row.anilist_id}</a>
            : muted(null)),
    },
    {
        key: 'description',
        header: 'About',
        hideOnPhone: true,
        cell: (row) => <span className="line-clamp-2 max-w-md text-[var(--text-2)]">{muted(row.description)}</span>,
    },
    countColumn(),
];

const personFields = (placeholder) => [
    { name: 'name', label: 'Name', required: true, placeholder, maxLength: 200 },
    { name: 'name_native', label: 'Native name', maxLength: 200 },
    { name: 'anilist_id', label: 'AniList id', type: 'number', hint: 'Links this record to AniList so syncs update it.' },
    { name: 'image_url', label: 'Image URL', type: 'url', placeholder: 'https://' },
    { name: 'description', label: 'About', type: 'textarea' },
];

const personToForm = (row) => ({
    name: text(row?.name),
    name_native: text(row?.name_native),
    anilist_id: text(row?.anilist_id),
    image_url: text(row?.image_url),
    description: text(row?.description),
});

const personToPayload = (form) => ({
    name: form.name.trim(),
    name_native: form.name_native.trim(),
    anilist_id: intOrNull(form.anilist_id),
    image_url: orNull(form.image_url),
    description: form.description.trim(),
});

const PERSON_SORT = [
    { value: 'name', label: 'Name, A to Z' },
    { value: '-name', label: 'Name, Z to A' },
    { value: '-id', label: 'Newest first' },
    { value: 'id', label: 'Oldest first' },
    { value: 'anilist_id', label: 'AniList id' },
];

export const characterConfig = {
    resource: 'characters',
    entity: 'character',
    modelLabel: 'anime.Character',
    singular: 'character',
    plural: 'characters',
    title: 'Characters',
    description: 'Characters credited in anime casts.',
    searchPlaceholder: 'Search by name or description',
    defaultOrdering: 'name',
    sortOptions: PERSON_SORT,
    publicHref: (row) => `/character/${row.id}`,
    columns: personColumns('Characters'),
    fields: personFields('Frieren'),
    toForm: personToForm,
    toPayload: personToPayload,
};

export const peopleConfig = {
    resource: 'staff',
    entity: 'staff',
    modelLabel: 'anime.Staff',
    singular: 'person',
    plural: 'people',
    title: 'People',
    description: 'Voice actors, directors, writers and other staff credited on anime.',
    searchPlaceholder: 'Search by name or description',
    defaultOrdering: 'name',
    sortOptions: PERSON_SORT,
    publicHref: (row) => `/staff/${row.id}`,
    columns: personColumns('People'),
    fields: personFields('Kana Hanazawa'),
    toForm: personToForm,
    toPayload: personToPayload,
};
