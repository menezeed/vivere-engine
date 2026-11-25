import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { catalogClient, catalogError, type CatalogFilters, type CatalogKind } from '@/catalog/client';
import { useAuth } from '@/auth/AuthProvider';
import { useDebounce } from '@/hooks/useDebounce';

const initial: CatalogFilters = { search: '', category: '', status: '', venueId: '', page: 1 };
const kindLabels = { activities: 'Atividades', venues: 'Locais' };
const statusLabels = { active: 'Ativo', archived: 'Arquivado', draft: 'Rascunho' };
const gapLabels = {
  title: 'Título', category: 'Categoria', category_unknown: 'Categoria desconhecida', venue: 'Local',
  date_or_recurrence: 'Data ou recorrência', price_or_free: 'Preço ou gratuidade',
  name: 'Nome', address: 'Endereço', coordinates: 'Coordenadas',
};
const control = 'rounded border border-gray-300 bg-white px-3 py-2 text-sm';

export function CatalogPage() {
  const { user } = useAuth();
  const [kind, setKind] = useState<CatalogKind>('activities');
  const [filters, setFilters] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const search = useDebounce(filters.search, 250);
  const venueId = useDebounce(filters.venueId, 250);
  const query = { ...filters, search, venueId };
  const list = useQuery({
    queryKey: ['fixture-catalog', user?.id, kind, query],
    queryFn: ({ signal }) => catalogClient.list(kind, query, signal),
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['fixture-catalog-detail', user?.id, kind, selectedId],
    queryFn: ({ signal }) => selectedId ? catalogClient.detail(kind, selectedId, signal) : null,
    enabled: selectedId !== null,
    retry: false,
  });
  const categories = useQuery({
    queryKey: ['fixture-catalog-categories', user?.id],
    queryFn: ({ signal }) => catalogClient.categories(signal),
    enabled: !!list.data,
    retry: false,
  });
  const venues = useQuery({
    queryKey: ['fixture-catalog-venue-options', user?.id],
    queryFn: ({ signal }) => catalogClient.list('venues', initial, signal, 100),
    enabled: kind === 'activities' && !!list.data,
    retry: false,
  });
  const pages = Math.max(1, list.data?.totalPages ?? 1);
  const record = detail.data?.data;

  function update(change: Partial<CatalogFilters>) {
    setSelectedId(null);
    setFilters(value => ({ ...value, page: 1, ...change }));
  }

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-xl font-bold text-vivere-dark">Catálogo de produção</h1>
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
          <span aria-hidden="true">ⓘ </span>{list.data?.environment.label ?? 'DADOS SINTÉTICOS — SOMENTE LEITURA'}
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm">Tipo
          <select className={control} value={kind} onChange={e => { setKind(e.target.value as CatalogKind); update(initial); }}>
            <option value="activities">Atividades</option>
            <option value="venues">Locais</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">Pesquisar
          <input className={control} type="search" maxLength={120} value={filters.search} onChange={e => update({ search: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">Estado no Engine
          <select className={control} value={filters.status} onChange={e => update({ status: e.target.value as CatalogFilters['status'] })}>
            <option value="">Todos</option>
            {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Categoria
          <input className={control} list="catalog-categories" maxLength={40} value={filters.category} onChange={e => update({ category: e.target.value })} />
        </label>
        <datalist id="catalog-categories">{categories.data?.items.map(category => <option key={category.key} value={category.key}>{category.label_pt}</option>)}</datalist>
        {kind === 'activities' && <>
          <label className="grid gap-1 text-sm">Local (ID)
            <input className={control} list="catalog-venues" maxLength={36} value={filters.venueId} onChange={e => update({ venueId: e.target.value })} />
          </label>
          <datalist id="catalog-venues">{venues.data?.items.map(venue => 'name' in venue && <option key={venue.id} value={venue.id}>{venue.name}</option>)}</datalist>
        </>}
      </div>

      {list.isPending && <p role="status">A carregar catálogo…</p>}
      {list.isError && <p role="alert">{catalogError(list.error)}</p>}
      {list.data?.items.length === 0 && <p role="status">Nenhum resultado para estes filtros.</p>}
      {!!list.data?.items.length && (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-left text-sm" aria-label={kindLabels[kind]}>
            <thead><tr className="border-b">
              {['Nome', 'Categoria', 'Estado no Engine', 'Completude'].map(column => <th key={column} scope="col" className="px-3 py-2">{column}</th>)}
            </tr></thead>
            <tbody>{list.data.items.map(entry => (
              <tr key={entry.id} className="border-b last:border-0">
                <td className="px-3 py-2"><button type="button" className="text-vivere-dark underline" onClick={() => setSelectedId(entry.id)}>{('title' in entry ? entry.title : entry.name) || 'Sem nome'}</button></td>
                <td className="px-3 py-2">{entry.category ?? '—'}</td>
                <td className="px-3 py-2">{entry.engine_status ? statusLabels[entry.engine_status] : '—'}</td>
                <td className="px-3 py-2">{entry.completeness.complete ? 'Completo' : 'Incompleto'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {list.data && <nav className="flex items-center gap-3 text-sm" aria-label="Paginação do catálogo">
        <button type="button" className={control + ' disabled:opacity-50'} disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>Anterior</button>
        <span>Página {filters.page} de {pages} · {list.data.totalItems} registros</span>
        <button type="button" className={control + ' disabled:opacity-50'} disabled={filters.page >= pages || filters.search !== search || filters.venueId !== venueId} onClick={() => update({ page: filters.page + 1 })}>Seguinte</button>
      </nav>}

      {selectedId && <section className="rounded border bg-white p-4" aria-label="Detalhe do catálogo">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{record && ('title' in record ? record.title : record.name) || 'Detalhe'}</h2>
          <button type="button" className={control} onClick={() => setSelectedId(null)}>Fechar detalhe</button>
        </div>
        {detail.isPending && <p role="status">A carregar detalhe…</p>}
        {detail.isError && <p role="alert">{catalogError(detail.error)}</p>}
        {record && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries({
            Estado: record.engine_status ? statusLabels[record.engine_status] : null,
            Categoria: record.category,
            ...('title' in record ? {
              Local: record.venue?.name, Programação: record.schedule, Início: record.start_date,
              Recorrência: record.recurrence_days?.join(', '), Horário: record.recurrence_time,
              Preço: record.is_free ? 'Gratuito' : record.price, Descrição: record.description,
            } : { Endereço: record.address, Horário: record.opening_hours }),
            Completude: record.completeness.complete ? 'Completo' : 'Faltam ' + record.completeness.missing.map(gap => gapLabels[gap]).join(', '),
          }).map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd>{value ?? '—'}</dd></div>)}
        </dl>}
      </section>}
    </div>
  );
}
