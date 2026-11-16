import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

import api from '../../../api/client';
import { adminKeys } from '../../../api/queries/admin';
import { useAdminList, useAdminMutation } from '../hooks/useAdminQuery';
import useAdminRole from '../hooks/useAdminRole';
import useDebouncedValue from '../hooks/useDebouncedValue';
import AdminPagination from './AdminPagination';
import BulkActions, { useBulkDelete } from './BulkActions';
import { useConfirm } from './ConfirmDialog';
import DataTable from './DataTable';
import Modal from './Modal';

const INPUT = 'w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500';
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const errorDetail = (err, fallback) => err?.response?.data?.detail || fallback;

function FormField({ field, value, onChange }) {
  const id = useId();
  const common = {
    id,
    value,
    required: field.required,
    placeholder: field.placeholder,
    onChange: (e) => onChange(field.name, e.target.value),
  };
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-white/70 mb-1">
        {field.label}{field.required ? ' *' : ''}
      </label>
      {field.type === 'textarea'
        ? <textarea {...common} rows={4} className={`${INPUT} resize-none`} />
        : <input {...common} type={field.type || 'text'} className={INPUT} />}
      {field.help && <p className="text-xs text-white/40 mt-1">{field.help}</p>}
    </div>
  );
}

FormField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func.isRequired,
};

/**
 * List + create/edit/delete page for one catalog resource (genres, studios,
 * characters, staff). Reads are open to staff; writes are superuser-only, so
 * staff see the list without the write controls.
 */
export default function CatalogCrudPage({
  resource,
  entityType,
  singular,
  plural,
  title,
  searchPlaceholder,
  columns,
  fields,
  emptyForm,
  toForm,
  toPayload = (form) => form,
  rowActions,
  forceDeleteParam = false,
}) {
  const { isSuperuser } = useAdminRole();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState('');
  const [selectedRows, setSelectedRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [confirm, confirmDialog] = useConfirm();

  const { items, totalPages, isFetching: loading } = useAdminList({
    resource,
    params: {
      page,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(ordering && { ordering }),
    },
    page,
    setPage,
    errorLog: `Failed to fetch ${plural}:`,
    errorToast: `Failed to load ${plural}`,
  });

  const invalidate = [adminKeys.resource(resource)];
  const saveMutation = useAdminMutation(
    ({ id, data }) => (id ? api.put(`/admin/${resource}/${id}/`, data) : api.post(`/admin/${resource}/`, data)),
    { invalidate },
  );
  const deleteMutation = useAdminMutation((id) => api.delete(`/admin/${resource}/${id}/`), { invalidate });
  const bulkDelete = useBulkDelete({
    entityType,
    noun: plural,
    invalidate,
    extra: forceDeleteParam ? { force: true } : {},
    onError: (message) => toast.error(message),
  });

  const openModal = (item = null) => {
    setEditing(item);
    setFormData(item ? toForm(item) : emptyForm);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditing(null);
    setFormData(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await saveMutation.mutateAsync({ id: editing?.id, data: toPayload(formData) });
      toast.success(`${capitalize(singular)} ${editing ? 'updated' : 'created'} successfully`);
      closeModal();
    } catch (err) {
      toast.error(errorDetail(err, `Failed to save ${singular}`));
    }
  };

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: `Delete ${singular}?`,
      message: `"${item.name}" will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success(`${capitalize(singular)} deleted successfully`);
    } catch (err) {
      toast.error(errorDetail(err, `Failed to delete ${singular}`));
    }
  };

  const handleBulkDelete = async () => {
    const result = await bulkDelete.start(selectedRows);
    if (result) {
      toast.success(result.message || `Deleted ${plural}`);
      setSelectedRows([]);
    }
  };

  const tableColumns = [
    ...columns,
    {
      key: 'actions',
      title: 'Actions',
      render: (item) => (
        <div className="flex flex-wrap items-center gap-2">
          {isSuperuser && (
            <button
              type="button"
              onClick={() => openModal(item)}
              className="px-3 py-1.5 text-sm bg-violet-500/20 text-violet-300 rounded-lg hover:bg-violet-500/30 transition-colors"
            >
              Edit
            </button>
          )}
          {rowActions?.(item)}
          {isSuperuser && (
            <button
              type="button"
              onClick={() => handleDelete(item)}
              className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {isSuperuser && (
          <button
            type="button"
            onClick={() => openModal()}
            className="px-4 py-2 min-h-[44px] sm:min-h-0 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
          >
            <Plus size={16} aria-hidden="true" /> Add {capitalize(singular)}
          </button>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <div className="relative">
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="search"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className={`${INPUT} pl-9`}
          />
        </div>
      </div>

      {isSuperuser && (
        <BulkActions
          selectedCount={selectedRows.length}
          actions={[{ label: 'Delete selected', icon: Trash2, variant: 'danger', onClick: handleBulkDelete }]}
          onClearSelection={() => setSelectedRows([])}
        />
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <DataTable
          columns={tableColumns}
          data={items}
          loading={loading}
          selectable={isSuperuser}
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          ordering={ordering}
          onSort={(next) => { setOrdering(next); setPage(1); }}
          emptyMessage={`No ${plural} found`}
        />
        <AdminPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`${editing ? 'Edit' : 'Create'} ${capitalize(singular)}`}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => (
            <FormField
              key={field.name}
              field={field}
              value={formData[field.name] ?? ''}
              onChange={(name, value) => setFormData((current) => ({ ...current, [name]: value }))}
            />
          ))}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {editing ? `Update ${capitalize(singular)}` : `Create ${capitalize(singular)}`}
            </button>
          </div>
        </form>
      </Modal>

      {bulkDelete.dialog}
      {confirmDialog}
    </div>
  );
}

CatalogCrudPage.propTypes = {
  resource: PropTypes.string.isRequired,
  entityType: PropTypes.string.isRequired,
  singular: PropTypes.string.isRequired,
  plural: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  searchPlaceholder: PropTypes.string.isRequired,
  columns: PropTypes.array.isRequired,
  fields: PropTypes.array.isRequired,
  emptyForm: PropTypes.object.isRequired,
  toForm: PropTypes.func.isRequired,
  toPayload: PropTypes.func,
  rowActions: PropTypes.func,
  forceDeleteParam: PropTypes.bool,
};
