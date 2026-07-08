// admin-panel/src/components/er/CandidateCard.tsx

import { CheckCircle, MapPin, BarChart2 } from 'lucide-react';
import type { ERCandidate } from '@/types/entityResolution';

interface CandidateCardProps {
  candidate:     ERCandidate;
  isTop:         boolean;
  canDecide:     boolean;
  isLoading:     boolean;
  onConfirm:     (candidateId: string) => void;
  onChoose:      (candidateId: string) => void;
}

function ScoreRow({ label, value, boost }: { label: string; value: number | null; boost?: number }) {
  if (value === null && !boost) return null;
  const display = value !== null ? Math.round(value * 100) : null;
  const boostDisplay = boost !== undefined && boost !== 0
    ? (boost > 0 ? `+${Math.round(boost * 100)}%` : `${Math.round(boost * 100)}%`)
    : null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400 w-24 shrink-0">{label}</span>
      {display !== null ? (
        <>
          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                display >= 85 ? 'bg-green-500' : display >= 50 ? 'bg-amber-400' : 'bg-gray-300'
              }`}
              style={{ width: `${display}%` }}
            />
          </div>
          <span className="text-gray-600 font-medium w-8 text-right">{display}%</span>
        </>
      ) : (
        <span className="flex-1 text-gray-300 italic">—</span>
      )}
      {boostDisplay && (
        <span className={`text-xs font-semibold w-10 text-right ${boost! > 0 ? 'text-green-500' : 'text-red-400'}`}>
          {boostDisplay}
        </span>
      )}
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  if (pct >= 85) return <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Alta confiança</span>;
  if (pct >= 65) return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Confiança média</span>;
  return <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Confiança baixa</span>;
}

export function CandidateCard({ candidate, isTop, canDecide, isLoading, onConfirm, onChoose }: CandidateCardProps) {
  const pct = Math.round(candidate.score * 100);
  const detail = candidate.matchDetail as Record<string, unknown> | null;
  const boost  = detail ? (detail['boostApplied'] as number | null) : null;
  const method = detail
    ? ((detail['nameDetail'] as string | undefined)?.includes('Exact match') ? 'Exact'
      : (detail['nameDetail'] as string | undefined)?.includes('contido') ? 'Contains'
      : (detail['nameDetail'] as string | undefined)?.includes('Jaccard') ? 'Tokens'
      : (detail['nameDetail'] as string | undefined)?.includes('Trigram') ? 'Trigram'
      : candidate.geoScore !== null ? 'Geo' : null)
    : null;

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      isTop
        ? 'border-vivere-teal/40 bg-teal-50/30 shadow-sm'
        : 'border-gray-200 bg-white'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {isTop && (
              <span className="text-xs font-bold text-vivere-teal uppercase tracking-wide">
                Sugestão principal
              </span>
            )}
            <ConfidenceBadge score={candidate.score} />
            {method && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                via {method}
              </span>
            )}
          </div>
          <p className="font-semibold text-vivere-dark truncate">{candidate.venueName}</p>
          {candidate.venueCity && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <MapPin size={10} /> {candidate.venueCity}
            </p>
          )}
        </div>
        {/* Score final */}
        <div className="text-right shrink-0">
          <div className={`text-2xl font-bold tabular-nums ${
            pct >= 85 ? 'text-green-600' : pct >= 65 ? 'text-amber-500' : 'text-gray-400'
          }`}>
            {pct}%
          </div>
          <div className="text-xs text-gray-400">score</div>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="space-y-1.5 mb-3 bg-gray-50 rounded-lg p-2.5 border border-gray-100">
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart2 size={11} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-500">Breakdown</span>
        </div>
        <ScoreRow label="Nome"      value={candidate.nameScore} />
        <ScoreRow label="Geo"       value={candidate.geoScore} />
        <ScoreRow label="Endereço"  value={candidate.addressScore} />
        {boost !== null && boost !== 0 && (
          <ScoreRow label="Confiança" value={null} boost={boost} />
        )}
      </div>

      {/* Acções */}
      {canDecide && !candidate.decisionOutcome && (
        <div className="flex gap-2">
          {isTop ? (
            <button
              onClick={() => onConfirm(candidate.id)}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-vivere-teal text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              <CheckCircle size={13} />
              Confirmar
            </button>
          ) : (
            <button
              onClick={() => onChoose(candidate.id)}
              disabled={isLoading}
              className="flex-1 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              Escolher este
            </button>
          )}
        </div>
      )}

      {candidate.decisionOutcome && (
        <div className={`text-xs font-medium px-2 py-1 rounded text-center ${
          candidate.decisionOutcome === 'accepted' ? 'bg-green-50 text-green-600' :
          candidate.decisionOutcome === 'rejected' ? 'bg-red-50 text-red-500' :
          'bg-gray-100 text-gray-500'
        }`}>
          {candidate.decisionOutcome === 'accepted' ? '✓ Aceite' :
           candidate.decisionOutcome === 'rejected' ? '✗ Rejeitado' : 'Ignorado'}
        </div>
      )}
    </div>
  );
}
