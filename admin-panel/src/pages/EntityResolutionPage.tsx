// admin-panel/src/pages/EntityResolutionPage.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ChevronRight, AlertTriangle } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { EntityResolutionService } from '@/services/EntityResolutionService';
import { CandidateCard } from '@/components/er/CandidateCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthProvider';
import {
  ER_STATUS_LABEL, ER_STATUS_COLOR, ER_STATUS_PRIORITY,
} from '@/types/entityResolution';
import type { ERQueueItem } from '@/types/entityResolution';
import type { AppOutletContext } from '@/types/shell';

const STATUS_TABS = [
  { value: '',            label: 'Todos' },
  { value: 'unresolved',  label: 'Não resolvidos' },
  { value: 'ambiguous',   label: 'Ambíguos' },
  { value: 'matched',     label: 'Identificados' },
  { value: 'proposed_new', label: 'Venue novo' },
];

// ── ActivityRow — linha expansível com candidatos ─────────────────────────────

function ActivityRow({
  item,
  canReview,
  isAdmin,
}: {
  item:      ERQueueItem;
  canReview: boolean;
  isAdmin:   boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded]               = useState(false);
  const [proposeOpen, setProposeOpen]         = useState(false);
  const [overrideId, setOverrideId]           = useState<string | null>(null);
  const [overrideNotes, setOverrideNotes]     = useState('');
  const [proposeNotes, setProposeNotes]       = useState('');

  const qc = useQueryClient();
  const { success, error } = useToast();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['er-queue'] });
    qc.invalidateQueries({ queryKey: ['er-stats'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  // Candidatos
  const { data: candidates = [], isLoading: loadingCandidates } = useQuery({
    queryKey:  ['er-candidates', item.activityId],
    queryFn:   () => EntityResolutionService.getCandidates(item.activityId),
    enabled:   expanded,
    staleTime: 30_000,
  });

  // Mutation accept
  const acceptMutation = useMutation({
    mutationFn: ({ candidateId, notes }: { candidateId: string; notes?: string }) =>
      EntityResolutionService.accept(item.activityId, candidateId, notes),
    onSuccess: () => { success('Venue confirmado com sucesso'); invalidate(); },
    onError:   (e) => error('Erro ao confirmar', String(e)),
  });

  // Mutation override
  const overrideMutation = useMutation({
    mutationFn: ({ candidateId, notes }: { candidateId: string; notes: string }) =>
      EntityResolutionService.override(item.activityId, candidateId, notes),
    onSuccess: () => { success('Override registado com sucesso'); setOverrideId(null); invalidate(); },
    onError:   (e) => error('Erro ao fazer override', String(e)),
  });

  // Mutation propose-new
  const proposeNewMutation = useMutation({
    mutationFn: (notes: string) =>
      EntityResolutionService.proposeNew(item.activityId, notes || undefined),
    onSuccess: () => { success('Marcado como venue novo'); setProposeOpen(false); invalidate(); },
    onError:   (e) => error('Erro ao propor venue novo', String(e)),
  });

  const isLoading = acceptMutation.isPending || overrideMutation.isPending || proposeNewMutation.isPending;
  const statusKey = item.venueResolutionStatus as keyof typeof ER_STATUS_LABEL;
  const hasDecision = item.venueResolutionStatus === 'matched' && item.topCandidateName;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Row header */}
      <button
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="mt-0.5 text-gray-400">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ER_STATUS_COLOR[statusKey] ?? 'bg-gray-100 text-gray-500'}`}>
              {ER_STATUS_LABEL[statusKey] ?? statusKey}
            </span>
            {item.resolutionConfidence !== null && (
              <span className="text-xs text-gray-400">
                score {Math.round(item.resolutionConfidence * 100)}%
              </span>
            )}
            {item.candidateCount > 0 && (
              <span className="text-xs text-gray-400">{item.candidateCount} candidatos</span>
            )}
          </div>
          <p className="font-medium text-vivere-dark text-sm truncate">
            {item.title ?? '(sem título)'}
          </p>
          {item.venueMentionText && (
            <p className="text-xs text-gray-500 mt-0.5">
              Mention: <span className="font-medium text-vivere-dark">"{item.venueMentionText}"</span>
              {item.venueMentionHint && <span className="ml-1 text-gray-400">({item.venueMentionHint})</span>}
            </p>
          )}
          {hasDecision && (
            <p className="text-xs text-green-600 mt-0.5">✓ {item.topCandidateName}</p>
          )}
        </div>
      </button>

      {/* Expanded — candidatos */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 bg-gray-50/50">
          {!item.venueMentionText ? (
            <p className="text-sm text-gray-400 italic">Esta actividade não tem VenueMention — nada a resolver.</p>
          ) : loadingCandidates ? (
            <p className="text-sm text-gray-400">A carregar candidatos...</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sem candidatos gerados ainda.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {(showAll ? candidates : candidates.slice(0, 3)).map((c, idx) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    isTop={idx === 0}
                    canDecide={canReview && !hasDecision}
                    isLoading={isLoading}
                    onConfirm={(candidateId) => acceptMutation.mutate({ candidateId })}
                    onChoose={(candidateId) => setOverrideId(candidateId)}
                  />
                ))}
              </div>
              {candidates.length > 3 && (
                <button
                  onClick={() => setShowAll(s => !s)}
                  className="text-xs text-vivere-teal hover:underline mb-3"
                >
                  {showAll ? `▲ Mostrar menos` : `▼ Ver todos os ${candidates.length} candidatos`}
                </button>
              )}

              {/* Acções adicionais */}
              {canReview && !hasDecision && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {isAdmin && (
                    <button
                      onClick={() => setProposeOpen(true)}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      <AlertTriangle size={12} />
                      Marcar como venue novo
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Dialog override */}
      {overrideId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOverrideId(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-vivere-dark mb-2">Escolher candidato diferente</h2>
            <p className="text-sm text-gray-500 mb-4">
              Está a escolher um candidato diferente do sugerido pelo motor. Por favor indique o motivo.
            </p>
            <textarea
              value={overrideNotes}
              onChange={e => setOverrideNotes(e.target.value)}
              placeholder="Motivo do override (obrigatório)..."
              className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-vivere-teal"
            />
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setOverrideId(null)} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button
                onClick={() => overrideMutation.mutate({ candidateId: overrideId, notes: overrideNotes })}
                disabled={!overrideNotes.trim() || overrideMutation.isPending}
                className="px-4 py-2 text-sm font-semibold text-white bg-vivere-teal rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {overrideMutation.isPending ? 'A processar...' : 'Confirmar override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog propose-new */}
      <ConfirmDialog
        open={proposeOpen}
        title="Marcar como venue novo"
        variant="warning"
        confirmLabel="Confirmar venue novo"
        isLoading={proposeNewMutation.isPending}
        message={
          <div className="space-y-3">
            <p>Esta actividade menciona um venue que não existe no sistema. Todos os candidatos serão marcados como irrelevantes.</p>
            <textarea
              value={proposeNotes}
              onChange={e => setProposeNotes(e.target.value)}
              placeholder="Notas opcionais..."
              className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-vivere-teal"
              onClick={e => e.stopPropagation()}
            />
          </div>
        }
        onConfirm={() => proposeNewMutation.mutate(proposeNotes)}
        onCancel={() => setProposeOpen(false)}
      />
    </div>
  );
}

// ── EntityResolutionPage ──────────────────────────────────────────────────────

export function EntityResolutionPage() {
  const { productKey } = useOutletContext<AppOutletContext>();
  const { user }       = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');

  const canReview  = user?.role === 'reviewer' || user?.role === 'admin';
  const isAdmin    = user?.role === 'admin';

  const { data: queue, isLoading } = useQuery({
    queryKey:  ['er-queue', productKey, statusFilter],
    queryFn:   () => EntityResolutionService.getQueue({
      product_key: productKey,
      status:      statusFilter || undefined,
      pageSize:    100,
    }),
    staleTime: 15_000,
  });

  const { data: erStats } = useQuery({
    queryKey:  ['er-stats', productKey],
    queryFn:   () => EntityResolutionService.getStats(productKey),
    staleTime: 15_000,
  });

  // Ordenar por prioridade, depois por score desc
  const items = [...(queue?.items ?? [])]
    .filter(item =>
      !search ||
      item.title?.toLowerCase().includes(search.toLowerCase()) ||
      item.venueMentionText?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const pa = ER_STATUS_PRIORITY[a.venueResolutionStatus] ?? 99;
      const pb = ER_STATUS_PRIORITY[b.venueResolutionStatus] ?? 99;
      if (pa !== pb) return pa - pb;
      return (b.resolutionConfidence ?? 0) - (a.resolutionConfidence ?? 0);
    });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-vivere-dark">Entity Resolution</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Revisão de venues identificados automaticamente
        </p>
      </div>

      {/* Stats pills */}
      {erStats && (
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { label: 'Total', value: erStats.total, color: 'bg-gray-100 text-gray-700' },
            { label: 'Identificados', value: erStats.matched, color: 'bg-green-100 text-green-700' },
            { label: 'Ambíguos', value: erStats.ambiguous, color: 'bg-amber-100 text-amber-700' },
            { label: 'Não resolvidos', value: erStats.unresolved, color: 'bg-blue-100 text-blue-700' },
            { label: 'Venue novo', value: erStats.proposed_new, color: 'bg-gray-100 text-gray-600' },
            { label: 'Decididos', value: erStats.decided, color: 'bg-teal-100 text-teal-700' },
          ].map(s => (
            <span key={s.label} className={`text-xs font-semibold px-3 py-1 rounded-full ${s.color}`}>
              {s.label}: {s.value}
            </span>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar por título ou mention..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-vivere-teal"
          />
        </div>
        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                statusFilter === tab.value
                  ? 'bg-white text-vivere-dark shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="text-sm text-gray-400 py-8 text-center">A carregar...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">Nenhuma actividade encontrada.</div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <ActivityRow
              key={item.activityId}
              item={item}
              canReview={canReview}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
