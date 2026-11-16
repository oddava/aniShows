import CatalogCrudPage from './components/CatalogCrudPage';
import {
  PERSON_EMPTY_FORM,
  personColumns,
  personFields,
  personToForm,
  personToPayload,
} from './components/personColumns';

const columns = personColumns('Anime Count');
const fields = personFields('Character Name');

const AdminCharacters = () => (
  <CatalogCrudPage
    resource="characters"
    entityType="character"
    singular="character"
    plural="characters"
    title="Character Management"
    searchPlaceholder="Search characters..."
    columns={columns}
    fields={fields}
    emptyForm={PERSON_EMPTY_FORM}
    toForm={personToForm}
    toPayload={personToPayload}
  />
);

export default AdminCharacters;
