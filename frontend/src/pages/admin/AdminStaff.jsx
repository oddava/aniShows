import CatalogCrudPage from './components/CatalogCrudPage';
import {
  PERSON_EMPTY_FORM,
  personColumns,
  personFields,
  personToForm,
  personToPayload,
} from './components/personColumns';

const columns = personColumns('Credits');
const fields = personFields('Staff Name');

const AdminStaff = () => (
  <CatalogCrudPage
    resource="staff"
    entityType="staff"
    singular="staff record"
    plural="staff records"
    title="Staff Management"
    searchPlaceholder="Search staff records..."
    columns={columns}
    fields={fields}
    emptyForm={PERSON_EMPTY_FORM}
    toForm={personToForm}
    toPayload={personToPayload}
  />
);

export default AdminStaff;
