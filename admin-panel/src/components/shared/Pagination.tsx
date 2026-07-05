interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}

const PAGE_SIZES = [20, 50, 100];

export function Pagination({ page, pageSize, totalItems, totalPages, onPage, onPageSize }: PaginationProps) {
  const from = Math.min((page - 1) * pageSize + 1, totalItems);
  const to   = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between py-3 px-1">
      <p className="text-sm text-gray-500">
        {totalItems > 0 ? `${from}–${to} de ${totalItems}` : '0 resultados'}
      </p>
      <div className="flex items-center gap-3">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={e => onPageSize(Number(e.target.value))}
            className="text-sm border rounded px-2 py-1 text-gray-600"
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s} por página</option>)}
          </select>
        )}
        <div className="flex gap-1">
          <button onClick={() => onPage(1)}        disabled={page === 1}          className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50">«</button>
          <button onClick={() => onPage(page - 1)} disabled={page === 1}          className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50">‹</button>
          <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
          <button onClick={() => onPage(page + 1)} disabled={page === totalPages} className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50">›</button>
          <button onClick={() => onPage(totalPages)} disabled={page === totalPages} className="px-2 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50">»</button>
        </div>
      </div>
    </div>
  );
}
