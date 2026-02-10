import { useState, useMemo } from 'react';

const DataTable = ({
  columns,
  data,
  loading = false,
  selectable = false,
  selectedRows = [],
  onSelectionChange,
  onRowClick,
  sortable = true,
  sortColumn,
  sortDirection,
  onSort,
  emptyMessage = 'No data found',
  keyExtractor = (item) => item.id,
}) => {
  const [internalSortColumn, setInternalSortColumn] = useState(null);
  const [internalSortDirection, setInternalSortDirection] = useState('asc');

  const currentSortColumn = sortColumn ?? internalSortColumn;
  const currentSortDirection = sortDirection ?? internalSortDirection;

  const handleSort = (columnKey) => {
    if (!sortable) return;
    
    const column = columns.find(col => col.key === columnKey);
    if (!column?.sortable) return;

    let newDirection = 'asc';
    if (currentSortColumn === columnKey) {
      newDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    }

    if (onSort) {
      onSort(columnKey, newDirection);
    } else {
      setInternalSortColumn(columnKey);
      setInternalSortDirection(newDirection);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      onSelectionChange?.(data.map(keyExtractor));
    } else {
      onSelectionChange?.([]);
    }
  };

  const handleSelectRow = (id) => {
    if (!onSelectionChange) return;
    
    if (selectedRows.includes(id)) {
      onSelectionChange(selectedRows.filter(rowId => rowId !== id));
    } else {
      onSelectionChange([...selectedRows, id]);
    }
  };

  const sortedData = useMemo(() => {
    if (!currentSortColumn || onSort) return data;
    
    return [...data].sort((a, b) => {
      const aVal = a[currentSortColumn];
      const bVal = b[currentSortColumn];
      
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      
      if (typeof aVal === 'string') {
        return currentSortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      return currentSortDirection === 'asc' 
        ? aVal - bVal 
        : bVal - aVal;
    });
  }, [data, currentSortColumn, currentSortDirection, onSort]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-white/60">
        <div className="w-12 h-12 border-3 border-violet-500/20 border-t-violet-500 rounded-full animate-spin mb-4"></div>
        <p>Loading data...</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-white/5 border-b border-white/5">
            {selectable && (
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={data.length > 0 && selectedRows.length === data.length}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500"
                />
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50 ${
                  column.sortable !== false && sortable ? 'cursor-pointer hover:text-white/70' : ''
                }`}
                onClick={() => handleSort(column.key)}
                style={{ width: column.width }}
              >
                <div className="flex items-center gap-1">
                  {column.title}
                  {currentSortColumn === column.key && (
                    <span className="text-violet-400">
                      {currentSortDirection === 'asc' ? ' ↑' : ' ↓'}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-4 py-12 text-center text-white/40"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((item) => {
              const itemKey = keyExtractor(item);
              const isSelected = selectedRows.includes(itemKey);
              
              return (
                <tr
                  key={itemKey}
                  className={`border-b border-white/5 transition-colors ${
                    onRowClick ? 'cursor-pointer' : ''
                  } ${isSelected ? 'bg-violet-500/10' : 'hover:bg-violet-500/5'}`}
                  onClick={() => onRowClick?.(item)}
                >
                  {selectable && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(itemKey)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={`${itemKey}-${column.key}`} className="px-4 py-3 text-sm text-white/85">
                      {column.render ? column.render(item) : item[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;
