import { Link } from 'react-router-dom';

import CatalogCrudPage from './components/CatalogCrudPage';

const columns = [
  { key: 'name', title: 'Name', render: (item) => <div className="font-medium text-white">{item.name}</div> },
  { key: 'slug', title: 'Slug', render: (item) => <span className="text-white/60">{item.slug}</span> },
  {
    key: 'anime_count',
    title: 'Anime Count',
    render: (item) => <span className="text-violet-300 font-medium">{item.anime_count}</span>,
  },
  {
    key: 'description',
    title: 'Description',
    render: (item) => (
      <span className="text-white/50 truncate max-w-xs block">{item.description || 'No description'}</span>
    ),
  },
];

const fields = [
  { name: 'name', label: 'Name', required: true, placeholder: 'e.g., Action' },
  {
    name: 'slug',
    label: 'Slug',
    placeholder: 'auto-generated if empty',
    help: 'URL-friendly identifier (auto-generated from name if empty)',
  },
  { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Genre description...' },
];

const EMPTY_FORM = { name: '', slug: '', description: '' };

const AdminGenres = () => (
  <CatalogCrudPage
    resource="genres"
    entityType="genre"
    singular="genre"
    plural="genres"
    title="Genre Management"
    searchPlaceholder="Search genres..."
    columns={columns}
    fields={fields}
    emptyForm={EMPTY_FORM}
    toForm={(genre) => ({ name: genre.name, slug: genre.slug, description: genre.description || '' })}
    rowActions={(item) => (
      <Link
        to={`/browse?genre=${item.slug}`}
        target="_blank"
        className="px-3 py-1.5 text-sm bg-white/10 text-white/80 rounded-lg hover:bg-white/20 transition-colors"
      >
        Open
      </Link>
    )}
  />
);

export default AdminGenres;
