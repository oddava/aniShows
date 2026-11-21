import PropTypes from 'prop-types';
import CustomSelect from '../common/CustomSelect';
import { getSortOptions } from './browseFilterOptions';

/**
 * The Browse sort picker. "Best match" is offered only while there is a
 * search (B1, P0-1); choosing it drops `sort` from the URL (see setSort).
 */
export default function SortSelect({ value, hasSearch, onChange }) {
  return (
    <CustomSelect
      ariaLabel="Sort by"
      value={value}
      onChange={onChange}
      options={getSortOptions(hasSearch)}
      placeholder="Sort"
      className="w-40"
      triggerClassName="!h-11 !rounded-lg !border-transparent !bg-white/[0.04] !px-3 !py-0 !text-sm !font-medium text-[var(--text-1)]"
    />
  );
}

SortSelect.propTypes = {
  value: PropTypes.string.isRequired,
  hasSearch: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};
