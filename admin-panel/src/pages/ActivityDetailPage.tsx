import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityService } from '@/services/ActivityService';
import { StatusBadge, VenueResolutionBadge, SourceBadge } from '@/components/shared/StatusBadge';
import { ReviewActions } from '@/components/shared/ReviewActions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionCard } from '@/components/ui/Cards';
import { Badge, Skeleton } from '@/components/ui/index';
import { useReviewMutation } from '@/hooks/useReviewMutation';
import type { ReviewAction } from '@/types/review';

export function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [payloadOpen, setPayloadOpen] = useState(false);

  const { data: activity, isLoading } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => ActivityService.get(id!),
    enabled: !!id,
  });

  const review = useReviewMutation({
    approve: ActivityService.approve,
    reject:  ActivityService.reject,
    promote: ActivityService.promote,
    invalidateKeys: [['activity', id!], ['activities'], ['stats']],
    labels: { approve: 'Actividade aprovada', reject: 'Actividade rejeitada', promote: 'Actividade promovida' },
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="p-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4">
          <ArrowLeft size={14} /> Voltar
        </button>
        <p className="text-gray-400">Actividade não encontrada.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      {/* Back + título */}
      <div>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4 transition-colors">
          <ArrowLeft size={14} /> Voltar
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-vivere-dark">{activity.title ?? 'Actividade sem título'}</h1>
            {activity.description && (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">{activity.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={activity.proposal_status} />
            {activity.source_key && <SourceBadge sourceKey={activity.source_key} />}
          </div>
        </div>
      </div>

      {/* Acções */}
      <SectionCard title="Acção de revisão">
        <ReviewActions
          status={activity.proposal_status}
          onAction={(action: ReviewAction) => review.mutate(activity.id, action)}
          isLoading={review.isPending}
        />
      </SectionCard>

      <div className="grid grid-cols-2 gap-6">
        {/* Venue Mention */}
        <SectionCard title="Venue Mencionado">
          {activity.venue_mention_raw_text ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">Texto da fonte</p>
                <p className="text-sm text-gray-700 font-medium">{activity.venue_mention_raw_text}</p>
              </div>
              {activity.venue_mention_confidence_hint && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Confiança</p>
                  <Badge variant={
                    activity.venue_mention_confidence_hint === 'explicit_name' ? 'green' :
                    activity.venue_mention_confidence_hint === 'inferred_from_context' ? 'yellow' : 'gray'
                  }>
                    {activity.venue_mention_confidence_hint.replace(/_/g, ' ')}
                  </Badge>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400 mb-1">Resolução</p>
                <VenueResolutionBadge status={activity.venue_resolution_status} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Nenhum venue mencionado pela fonte</p>
          )}
        </SectionCard>

        {/* Occurrences */}
        <SectionCard title="Datas e Horários">
          {activity.occurrences && activity.occurrences.length > 0 ? (
            <div className="space-y-2">
              {activity.occurrences.map((occ, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                  <Calendar size={12} className="text-gray-400 shrink-0" />
                  <span>{occ.date}</span>
                  {occ.time && <span className="text-gray-400">às {occ.time}</span>}
                  {occ.end_time && <span className="text-gray-400">– {occ.end_time}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Sem datas extraídas</p>
          )}
        </SectionCard>
      </div>

      {/* Links */}
      {(activity.external_url || activity.image_url) && (
        <SectionCard title="Links">
          <div className="space-y-2">
            {activity.external_url && (
              <a href={activity.external_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-vivere-teal hover:underline">
                <ExternalLink size={12} /> Ver publicação original
              </a>
            )}
            {activity.image_url && (
              <a href={activity.image_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-vivere-teal hover:underline">
                <ExternalLink size={12} /> Ver imagem
              </a>
            )}
          </div>
        </SectionCard>
      )}

      {/* Auditoria */}
      {(activity.reviewed_at || activity.promoted_at) && (
        <SectionCard title="Auditoria">
          <div className="grid grid-cols-3 gap-4 text-sm">
            {activity.reviewed_at && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Revisto em</p>
                <p className="text-gray-700">{new Date(activity.reviewed_at).toLocaleString('pt-BR')}</p>
              </div>
            )}
            {activity.promoted_at && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Promovido em</p>
                <p className="text-gray-700">{new Date(activity.promoted_at).toLocaleString('pt-BR')}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 mb-1">Ingerido em</p>
              <p className="text-gray-700">{new Date(activity.created_at).toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Payload bruto */}
      {activity.raw_payload && (
        <div className="bg-white rounded-xl border border-gray-200">
          <button onClick={() => setPayloadOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:bg-gray-50 transition-colors">
            Payload Bruto
            {payloadOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {payloadOpen && (
            <div className="border-t px-5 py-4">
              <pre className="text-xs text-gray-600 overflow-auto max-h-96 font-mono">
                {JSON.stringify(activity.raw_payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
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
