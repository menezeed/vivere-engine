import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Phone, Globe, Clock, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { VenueService } from '@/services/VenueService';
import { StatusBadge, SourceBadge, GeographicStatusBadge } from '@/components/shared/StatusBadge';
import { ReviewActions } from '@/components/shared/ReviewActions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SectionCard } from '@/components/ui/Cards';
import { Badge, Skeleton } from '@/components/ui/index';
import { useReviewMutation } from '@/hooks/useReviewMutation';
import type { ReviewAction } from '@/types/review';

export function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [payloadOpen, setPayloadOpen] = useState(false);

  const { data: venue, isLoading } = useQuery({
    queryKey: ['venue', id],
    queryFn: () => VenueService.get(id!),
    enabled: !!id,
  });

  const review = useReviewMutation({
    approve: VenueService.approve,
    reject:  VenueService.reject,
    promote: VenueService.promote,
    invalidateKeys: [['venue', id!], ['venues'], ['stats']],
    labels: { approve: 'Venue aprovado', reject: 'Venue rejeitado', promote: 'Venue promovido' },
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="p-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4">
          <ArrowLeft size={14} /> Voltar
        </button>
        <p className="text-gray-400">Venue não encontrado.</p>
      </div>
    );
  }

  const mapsUrl = venue.lat && venue.lng
    ? `https://www.google.com/maps?q=${venue.lat},${venue.lng}`
    : null;

  // ADR-0022 — usado para o aviso contextual no diálogo de promoção.
  const isOutsideRegion = venue.geographic_status === 'outside_region';

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
            <h1 className="text-2xl font-bold text-vivere-dark">{venue.name ?? 'Venue sem nome'}</h1>
            <p className="text-sm text-gray-500 mt-1">{venue.address ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={venue.proposal_status} />
            <GeographicStatusBadge status={venue.geographic_status} />
            <SourceBadge sourceKey={venue.source_key} />
          </div>
        </div>
      </div>

      {/* Acções */}
      <SectionCard title="Acção de revisão">
        <ReviewActions
          status={venue.proposal_status}
          onAction={(action: ReviewAction) => review.mutate(venue.id, action)}
          isLoading={review.isPending}
        />
      </SectionCard>

      <div className="grid grid-cols-2 gap-6">
        {/* Informações */}
        <SectionCard title="Informações">
          <div className="space-y-3">
            {venue.source_category_hint && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Categoria</p>
                <Badge variant="default">{venue.source_category_hint}</Badge>
              </div>
            )}
            {venue.google_business_status && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Estado</p>
                <Badge variant={venue.google_business_status === 'OPERATIONAL' ? 'green' : 'gray'}>
                  {venue.google_business_status}
                </Badge>
              </div>
            )}
            {venue.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Phone size={13} className="text-gray-400" />
                <a href={`tel:${venue.phone}`} className="hover:underline">{venue.phone}</a>
              </div>
            )}
            {venue.website && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Globe size={13} className="text-gray-400" />
                <a href={venue.website} target="_blank" rel="noopener noreferrer"
                  className="hover:underline truncate max-w-[180px]">
                  {venue.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            {venue.opening_hours_raw && (
              <div>
                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Clock size={11} /> Horário</p>
                <p className="text-xs text-gray-600 whitespace-pre-line">{venue.opening_hours_raw}</p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Localização */}
        <SectionCard title="Localização">
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2 text-gray-700">
              <MapPin size={13} className="text-gray-400 mt-0.5 shrink-0" />
              <span>{venue.address ?? '—'}</span>
            </div>
            {venue.lat && venue.lng && (
              <p className="text-xs text-gray-400 font-mono">{venue.lat.toFixed(6)}, {venue.lng.toFixed(6)}</p>
            )}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-vivere-teal hover:underline mt-2">
                <ExternalLink size={11} /> Ver no Google Maps
              </a>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Google Types */}
      {venue.google_types && venue.google_types.length > 0 && (
        <SectionCard title="Google Types">
          <div className="flex flex-wrap gap-1.5">
            {venue.google_types.map(t => <Badge key={t} variant="default">{t}</Badge>)}
          </div>
        </SectionCard>
      )}

      {/* Filtering Decision — inalterada, volta à forma original.
          source_query_text explica COMO o venue foi encontrado (etapa
          de coleta); geographic_status explica COMO foi classificado
          geograficamente (etapa distinta do pipeline) — por isso vive
          numa secção própria, abaixo, em vez de partilhar esta. */}
      {venue.source_query_text && (
        <SectionCard title="Venue Filtering Decision">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-1">Query executada</p>
              <p className="text-gray-700">{venue.source_query_text}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Tipo de query</p>
              <Badge variant={venue.source_query_kind === 'place_type' ? 'blue' : 'purple'}>
                {venue.source_query_kind ?? '—'}
              </Badge>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Regional Geographic Gate (ADR-0022) — secção SEMPRE presente,
          mesmo sem geographic_status. Uma secção que desaparece deixa
          o reviewer sem saber se o dado nunca foi avaliado, se a fonte
          não suporta região, ou se é um venue anterior à ADR-0022 —
          três situações distintas que "sem secção" não distingue.
          Distinta de Venue Filtering Decision: são duas etapas
          diferentes do pipeline (tipo/keyword vs. geografia), nunca
          combinadas em nenhuma outra camada desta plataforma. */}
      <SectionCard title="Regional Geographic Gate">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-1">Geographic Status</p>
            {venue.geographic_status ? (
              <GeographicStatusBadge status={venue.geographic_status} />
            ) : (
              <span className="text-xs text-gray-400 italic">
                Não avaliado — fonte sem região, ou anterior à ADR-0022
              </span>
            )}
          </div>
          {isOutsideRegion && (
            <p className="text-xs text-red-600">
              ⚠ Este venue está fora do raio configurado para a região — a Publishing Engine não o publicará,
              mesmo que seja aprovado e promovido.
            </p>
          )}
        </div>
      </SectionCard>

      {/* Auditoria */}
      {(venue.reviewed_at || venue.promoted_at) && (
        <SectionCard title="Auditoria">
          <div className="grid grid-cols-3 gap-4 text-sm">
            {venue.reviewed_at && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Revisto em</p>
                <p className="text-gray-700">{new Date(venue.reviewed_at).toLocaleString('pt-BR')}</p>
              </div>
            )}
            {venue.promoted_at && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Promovido em</p>
                <p className="text-gray-700">{new Date(venue.promoted_at).toLocaleString('pt-BR')}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 mb-1">Ingerido em</p>
              <p className="text-gray-700">{new Date(venue.created_at).toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Payload bruto */}
      {venue.raw_payload && (
        <div className="bg-white rounded-xl border border-gray-200">
          <button onClick={() => setPayloadOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:bg-gray-50 transition-colors">
            Payload Bruto
            {payloadOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {payloadOpen && (
            <div className="border-t px-5 py-4">
              <pre className="text-xs text-gray-600 overflow-auto max-h-96 font-mono">
                {JSON.stringify(venue.raw_payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={review.confirmState.open}
        title="Promover venue"
        message={
          isOutsideRegion
            ? '⚠ Este venue está classificado como "fora da região" pelo Regional Geographic Gate (ADR-0022). A Publishing Engine não o publicará, independentemente desta aprovação. Tem a certeza que quer promover mesmo assim?'
            : 'Tem a certeza que quer promover este venue para produção?'
        }
        confirmLabel="Promover"
        variant="success"
        isLoading={review.isPending}
        onConfirm={review.confirmPromote}
        onCancel={review.cancelConfirm}
      />
    </div>
  );
}
