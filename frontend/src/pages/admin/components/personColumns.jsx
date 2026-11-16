/* Shared table/form config for the Characters and Staff admin pages. */

export const personColumns = (countTitle) => [
  {
    key: 'name',
    title: 'Name',
    sortable: true,
    render: (item) => (
      <div className="flex items-center gap-3">
        <div className="w-10 h-14 rounded bg-white/10 overflow-hidden flex-shrink-0">
          {item.image ? (
            <img src={item.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">N/A</div>
          )}
        </div>
        <div>
          <div className="font-medium text-white">{item.name}</div>
          <div className="text-xs text-white/50">{item.name_native || 'No native name'}</div>
        </div>
      </div>
    ),
  },
  {
    key: 'anilist_id',
    title: 'AniList ID',
    sortable: true,
    render: (item) => <span className="text-white/70">{item.anilist_id || '-'}</span>,
  },
  {
    key: 'anime_count',
    title: countTitle,
    render: (item) => <span className="text-violet-300 font-medium">{item.anime_count || 0}</span>,
  },
  {
    key: 'description',
    title: 'Description',
    render: (item) => (
      <span className="text-white/60 text-sm line-clamp-2 max-w-md">{item.description || 'No description'}</span>
    ),
  },
];

export const personFields = (namePlaceholder) => [
  { name: 'name', label: 'Name', required: true, placeholder: namePlaceholder },
  { name: 'name_native', label: 'Native name' },
  { name: 'anilist_id', label: 'AniList ID', type: 'number' },
  { name: 'image_url', label: 'Image URL', type: 'url' },
  { name: 'description', label: 'Description', type: 'textarea' },
];

export const PERSON_EMPTY_FORM = { name: '', name_native: '', description: '', anilist_id: '', image_url: '' };

export const personToForm = (person) => ({
  name: person.name || '',
  name_native: person.name_native || '',
  description: person.description || '',
  anilist_id: person.anilist_id || '',
  image_url: person.image_url || '',
});

export const personToPayload = (form) => ({
  ...form,
  anilist_id: form.anilist_id ? Number(form.anilist_id) : null,
});
