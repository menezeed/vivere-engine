import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { VenueService } from '@/services/VenueService';
import { StatusBadge, SourceBadge } from '@/components/shared/StatusBadge';
import { ReviewActions } from '@/components/shared/ReviewActions';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterBar, type FilterDef, type FilterValues } from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui/Cards';
import { BulkActions } from '@/components/ui/BulkActions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/shared/Pagination';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { useDebounce } from '@/hooks/useDebounce';
import { useReviewMutation } from '@/hooks/useReviewMutation';
import type { AppOutletContext } from '@/types/shell';
import type { ProposalStatus, ReviewAction } from '@/types/review';
import type { VenueStagingItem } from '@/types/venue';


// Configuração de filtros — sem referência a Venue nos componentes
const FILTER_DEFS: FilterDef[] = [
  {
    key: 'search',
    label: 'Nome',
    type: 'search',
    placeholder: 'Pesquisar por nome...',
    width: 'w-60',
  },
  {
    key: 'city',
    label: 'Cidade',
    type: 'search',
    placeholder: 'Filtrar cidade...',
    width: 'w-44',
  },
  {
    key: 'category',
    label: 'Categoria',
    type: 'select',
    width: 'w-40',
    options: [
      { value: 'teatro',        label: 'Teatro' },
      { value: 'centro_cultural', label: 'Centro Cultural' },
      { value: 'museu',         label: 'Museu' },
      { value: 'parque',        label: 'Parque' },
      { value: 'biblioteca',    label: 'Biblioteca' },
      { value: 'hidroginastica', label: 'Hidroginástica' },
      { value: 'danca_idosos',  label: 'Dança' },
    ],
  },
];

const STATUS_TABS: { value: ProposalStatus; label: string }[] = [
  { value: 'pending_review', label: 'Pendentes' },
  { value: 'approved',       label: 'Aprovados' },
  { value: 'rejected',       label: 'Rejeitados' },
  { value: 'promoted',       label: 'Promovidos' },
];

const ACTION_LABELS: Record<ReviewAction, string> = {
  approve: 'Venue aprovado',
  reject:  'Venue rejeitado',
  promote: 'Venue promovido',
};

export function VenuesPage() {
  const { productKey } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();

  // Filtros sincronizados com URL
  const { filters, setFilter, setFilters, clearFilters, page, setPage } = useUrlFilters({
    status:   'pending_review',
    search:   undefined as string | undefined,
    city:     undefined as string | undefined,
    category: undefined as string | undefined,
    pageSize: '20',
    sort:     'created_at',
    order:    'desc',
  });

  const status   = (filters.status ?? 'pending_review') as ProposalStatus;
  const pageSize = Number(filters.pageSize ?? 20);

  // Debounce em search e city — 400ms
  const search = useDebounce(filters.search, 400);
  const city   = useDebounce(filters.city, 400);

  // Selecção múltipla
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const review = useReviewMutation({
    approve: VenueService.approve,
    reject:  VenueService.reject,
    promote: VenueService.promote,
    invalidateKeys: [['venues'], ['stats']],
    labels: ACTION_LABELS,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['venues', productKey, status, page, pageSize, search, city, filters.category, filters.sort, filters.order],
    queryFn: () => VenueService.list({
      status, product_key: productKey, page, pageSize,
      search:   search   || undefined,
      city:     city     || undefined,
      category: filters.category || undefined,
      sort:     filters.sort,
      order:    filters.order as 'asc' | 'desc',
    }),
  });

  // Colunas do DataTable — genéricas
  const columns: ColumnDef<VenueStagingItem>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortable: true,
      render: (row) => (
        <p className="font-medium text-vivere-dark truncate max-w-[200px]">
          {row.name ?? <span className="text-gray-400 italic text-xs">sem nome</span>}
        </p>
      ),
    },
    {
      key: 'city',
      header: 'Cidade',
      sortable: false,
      render: (row) => <span className="text-gray-500 text-sm">{row.city ?? '—'}</span>,
    },
    {
      key: 'source_category_hint',
      header: 'Categoria',
      render: (row) => <span className="text-gray-500 text-xs">{row.source_category_hint ?? '—'}</span>,
    },
    {
      key: 'source_key',
      header: 'Fonte',
      render: (row) => <SourceBadge sourceKey={row.source_key} />,
    },
    {
      key: 'proposal_status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.proposal_status} />,
    },
    {
      key: 'created_at',
      header: 'Colectado',
      sortable: true,
      render: (row) => (
        <span className="text-gray-400 text-xs whitespace-nowrap">
          {new Date(row.created_at).toLocaleDateString('pt-BR')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acções',
      render: (row) => (
        <ReviewActions
          status={row.proposal_status}
          onAction={(action) => review.mutate(row.id, action)}
          isLoading={review.isLoading(row.id)}
          compact
        />
      ),
    },
  ];

  const filterValues: FilterValues = {
    search:   filters.search,
    city:     filters.city,
    category: filters.category,
  };

  return (
    <div className="p-8 space-y-5">
      {/* Header */}
      <PageHeader
        title="Venues"
        subtitle={data ? `${data.totalItems} registos · ${productKey}` : productKey}
        badge={
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 ml-2">
            {STATUS_TABS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setFilter('status', opt.value); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  status === opt.value
                    ? 'bg-white text-vivere-dark shadow-sm font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
        actions={
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <MapPin size={13} />
            <span>{data?.totalItems ?? '—'} venues</span>
          </div>
        }
      />

      {/* Filtros */}
      <FilterBar
        filters={FILTER_DEFS}
        values={filterValues}
        onChange={(key, val) => setFilter(key as keyof typeof filters, val)}
        onClearAll={clearFilters}
      />

      {/* Bulk Actions */}
      <BulkActions
        selectedCount={selectedIds.size}
        totalCount={data?.totalItems ?? 0}
        onSelectAll={() => setSelectedIds(new Set(data?.items.map(v => v.id) ?? []))}
        onClearSelection={() => setSelectedIds(new Set())}
        batchEnabled={false}
      />

      {/* Tabela */}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        keyExtractor={row => row.id}
        isLoading={isLoading}
        skeletonRows={pageSize}
        emptyTitle="Nenhum venue encontrado"
        emptyMessage={search ? `Sem resultados para "${search}"` : `Sem venues ${status.replace('_', ' ')}`}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sortKey={filters.sort}
        sortOrder={filters.order as 'asc' | 'desc'}
        onSort={(key, order) => setFilters({ sort: key, order })}
        onRowClick={(row) => navigate(`/venues/${row.id}`)}
      />

      {/* Paginação */}
      {data && data.totalPages > 1 && (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          totalItems={data.totalItems}
          totalPages={data.totalPages}
          onPage={setPage}
          onPageSize={(s) => { setFilter('pageSize', String(s)); setPage(1); }}
        />
      )}

      {/* Confirm dialog para Promote */}
      <ConfirmDialog
        open={review.confirmState.open}
        title="Promover venue"
        message="Tem a certeza que quer promover este venue? Esta acção marca-o como pronto para produção."
        confirmLabel="Promover"
        cancelLabel="Cancelar"
        variant="success"
        isLoading={review.isPending}
        onConfirm={review.confirmPromote}
        onCancel={review.cancelConfirm}
      />
    </div>
  );
}
