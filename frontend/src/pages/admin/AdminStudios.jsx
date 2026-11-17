import CatalogCrudPage from './components/CatalogCrudPage';

const columns = [
  { key: 'name', title: 'Name', render: (item) => <div className="font-medium text-white">{item.name}</div> },
  {
    key: 'founded_date',
    title: 'Founded',
    render: (item) => (
      <span className="text-white/60">{item.founded_date ? new Date(item.founded_date).getFullYear() : 'N/A'}</span>
    ),
  },
  {
    key: 'website',
    title: 'Website',
    render: (item) => (item.website ? (
      <a href={item.website} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200">
        Visit
      </a>
    ) : <span className="text-white/40">No website</span>),
  },
  {
    key: 'anime_count',
    title: 'Anime Count',
    render: (item) => <span className="text-violet-300 font-medium">{item.anime_count}</span>,
  },
];

const fields = [
  { name: 'name', label: 'Name', required: true, placeholder: 'e.g., Kyoto Animation' },
  { name: 'founded_date', label: 'Founded Date', type: 'date' },
  { name: 'website', label: 'Website', type: 'url', placeholder: 'https://...' },
];

const EMPTY_FORM = { name: '', founded_date: '', website: '' };

const AdminStudios = () => (
  <CatalogCrudPage
    resource="studios"
    entityType="studio"
    singular="studio"
    plural="studios"
    title="Studio Management"
    searchPlaceholder="Search studios..."
    columns={columns}
    fields={fields}
    emptyForm={EMPTY_FORM}
    toForm={(studio) => ({
      name: studio.name,
      founded_date: studio.founded_date || '',
      website: studio.website || '',
    })}
  />
);

export default AdminStudios;
