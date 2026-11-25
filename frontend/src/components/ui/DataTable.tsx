import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Wert für die Sortierung; ohne Angabe ist die Spalte nicht sortierbar */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  width?: number | string;
}

/**
 * Sortierbare Tabelle mit optionaler Seitenaufteilung und Zeilen-Klick.
 * Filterung erfolgt bewusst außerhalb (in der Seite), damit Filter in der URL
 * gehalten werden können.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  initialSort,
  pageSize = 25,
  empty = 'Keine Einträge gefunden.',
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  empty?: ReactNode;
}) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'de', { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.sortValue ? 'sortable' : ''} ${c.align === 'right' ? 'num' : ''}`}
                  style={{ width: c.width }}
                  onClick={c.sortValue ? () => toggleSort(c.key) : undefined}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.header}
                  {sort?.key === c.key && <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={rowKey(row)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="empty">{empty}</div>}
      </div>
      {sorted.length > pageSize && (
        <div className="table-foot">
          <span>
            {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} von {sorted.length}
          </span>
          <div className="hstack">
            <button className="btn small" disabled={current === 0} onClick={() => setPage(current - 1)}>Zurück</button>
            <span>Seite {current + 1} / {pages}</span>
            <button className="btn small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Weiter</button>
          </div>
        </div>
      )}
      {sorted.length <= pageSize && sorted.length > 0 && (
        <div className="table-foot"><span>{sorted.length} Einträge</span></div>
      )}
    </>
  );
}
