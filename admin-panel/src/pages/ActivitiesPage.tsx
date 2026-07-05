import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import { ActivityService } from '@/services/ActivityService';
import { StatusBadge, VenueResolutionBadge, SourceBadge } from '@/components/shared/StatusBadge';
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
import type { ProposalStatus } from '@/types/review';
import type { ActivityStagingItem } from '@/types/activity';

const FILTER_DEFS: FilterDef[] = [
  { key: 'search', label: 'Título', type: 'search', placeholder: 'Pesquisar por título...', width: 'w-60' },
  {
    key: 'venue_resolution',
    label: 'Resolução de venue',
    type: 'select',
    width: 'w-44',
    options: [
      { value: 'unresolved',   label: '○ Não resolvido' },
      { value: 'matched',      label: '✓ Resolvido' },
      { value: 'ambiguous',    label: '⚠ Ambíguo' },
      { value: 'proposed_new', label: '+ Novo proposto' },
    ],
  },
];

const STATUS_TABS: { value: ProposalStatus; label: string }[] = [
  { value: 'pending_review', label: 'Pendentes' },
  { value: 'approved',       label: 'Aprovadas' },
  { value: 'rejected',       label: 'Rejeitadas' },
  { value: 'promoted',       label: 'Promovidas' },
];

export function ActivitiesPage() {
  const { productKey } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();

  const { filters, setFilter, setFilters, clearFilters, page, setPage } = useUrlFilters({
    status:           'pending_review',
    search:           undefined as string | undefined,
    venue_resolution: undefined as string | undefined,
    pageSize:         '20',
    sort:             'created_at',
    order:            'desc',
  });

  const status   = (filters.status ?? 'pending_review') as ProposalStatus;
  const pageSize = Number(filters.pageSize ?? 20);
  const search   = useDebounce(filters.search, 400);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const review = useReviewMutation({
    approve: ActivityService.approve,
    reject:  ActivityService.reject,
    promote: ActivityService.promote,
    invalidateKeys: [['activities'], ['stats']],
    labels: {
      approve: 'Actividade aprovada',
      reject:  'Actividade rejeitada',
      promote: 'Actividade promovida',
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['activities', productKey, status, page, pageSize, search, filters.venue_resolution, filters.sort, filters.order],
    queryFn: () => ActivityService.list({
      status, product_key: productKey, page, pageSize,
      search:           search || undefined,
      venue_resolution: filters.venue_resolution || undefined,
      sort:             filters.sort,
      order:            filters.order as 'asc' | 'desc',
    }),
  });

  const columns: ColumnDef<ActivityStagingItem>[] = [
    {
      key: 'title', header: 'Título', sortable: true,
      render: (row) => (
        <p className="font-medium text-vivere-dark truncate max-w-[220px]">
          {row.title ?? <span className="text-gray-400 italic text-xs">sem título</span>}
        </p>
      ),
    },
    {
      key: 'venue_mention', header: 'Venue',
      render: (row) => (
        <span className="text-gray-500 text-xs truncate max-w-[130px] block">
          {row.venue_mention_raw_text ?? '—'}
        </span>
      ),
    },
    {
      key: 'venue_resolution_status', header: 'Resolução',
      render: (row) => <VenueResolutionBadge status={row.venue_resolution_status} />,
    },
    {
      key: 'source_key', header: 'Fonte',
      render: (row) => row.source_key ? <SourceBadge sourceKey={row.source_key} /> : null,
    },
    {
      key: 'proposal_status', header: 'Status',
      render: (row) => <StatusBadge status={row.proposal_status} />,
    },
    {
      key: 'created_at', header: 'Colectado', sortable: true,
      render: (row) => (
        <span className="text-gray-400 text-xs whitespace-nowrap">
          {new Date(row.created_at).toLocaleDateString('pt-BR')}
        </span>
      ),
    },
    {
      key: 'actions', header: 'Acções',
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
    search:           filters.search,
    venue_resolution: filters.venue_resolution,
  };

  return (
    <div className="p-8 space-y-5">
      <PageHeader
        title="Actividades"
        subtitle={data ? `${data.totalItems} registos · ${productKey}` : productKey}
        badge={
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 ml-2">
            {STATUS_TABS.map(opt => (
              <button key={opt.value}
                onClick={() => { setFilter('status', opt.value); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  status === opt.value ? 'bg-white text-vivere-dark shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        }
        actions={
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Calendar size={13} />
            <span>{data?.totalItems ?? '—'} actividades</span>
          </div>
        }
      />

      <FilterBar
        filters={FILTER_DEFS}
        values={filterValues}
        onChange={(key, val) => setFilter(key as keyof typeof filters, val)}
        onClearAll={clearFilters}
      />

      <BulkActions
        selectedCount={selectedIds.size}
        totalCount={data?.totalItems ?? 0}
        onSelectAll={() => setSelectedIds(new Set(data?.items.map(a => a.id) ?? []))}
        onClearSelection={() => setSelectedIds(new Set())}
        batchEnabled={false}
      />

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        keyExtractor={row => row.id}
        isLoading={isLoading}
        skeletonRows={pageSize}
        emptyTitle="Nenhuma actividade encontrada"
        emptyMessage={search ? `Sem resultados para "${search}"` : 'Sem actividades neste estado'}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sortKey={filters.sort}
        sortOrder={filters.order as 'asc' | 'desc'}
        onSort={(key, order) => setFilters({ sort: key, order })}
        onRowClick={(row) => navigate(`/activities/${row.id}`)}
      />

      {data && data.totalPages > 1 && (
        <Pagination
          page={data.page} pageSize={data.pageSize}
          totalItems={data.totalItems} totalPages={data.totalPages}
          onPage={setPage}
          onPageSize={(s) => { setFilter('pageSize', String(s)); setPage(1); }}
        />
      )}

      <ConfirmDialog
        open={review.confirmState.open}
        title="Promover actividade"
        message="Tem a certeza que quer promover esta actividade para produção?"
        confirmLabel="Promover"
        variant="success"
        isLoading={review.isPending}
        onConfirm={review.confirmPromote}
        onCancel={review.cancelConfirm}
      />
    </div>
  );
}
