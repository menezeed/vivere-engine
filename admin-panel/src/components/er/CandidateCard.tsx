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

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-10">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${pct >= 85 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-gray-300'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
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

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      isTop
        ? 'border-vivere-teal/40 bg-teal-50/30 shadow-sm'
        : 'border-gray-200 bg-white'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isTop && <span className="text-xs font-bold text-vivere-teal uppercase tracking-wide">Sugestão principal</span>}
            <ConfidenceBadge score={candidate.score} />
            {candidate.decisionOutcome && (
              <span className="text-xs text-gray-400">({candidate.decisionOutcome})</span>
            )}
          </div>
          <p className="font-semibold text-vivere-dark mt-1 truncate">{candidate.venueName}</p>
          {candidate.venueCity && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <MapPin size={10} /> {candidate.venueCity}
            </p>
          )}
        </div>
        {/* Score */}
        <div className="text-right shrink-0">
          <div className={`text-2xl font-bold ${pct >= 85 ? 'text-green-600' : pct >= 65 ? 'text-amber-500' : 'text-gray-400'}`}>
            {pct}%
          </div>
          <div className="text-xs text-gray-400">score final</div>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="space-y-1.5 mb-3 bg-white/60 rounded-lg p-2.5 border border-gray-100">
        <div className="flex items-center gap-1.5 mb-1.5">
          <BarChart2 size={11} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-500">Score breakdown</span>
        </div>
        <ScoreBar label="Nome"  value={candidate.nameScore} />
        <ScoreBar label="Geo"   value={candidate.geoScore} />
        <ScoreBar label="Endereço" value={candidate.addressScore} />
      </div>

      {/* Match detail */}
      {detail && (
        <div className="text-xs text-gray-400 mb-3 space-y-0.5 px-1">
          {detail['nameDetail'] && <p className="truncate">📝 {String(detail['nameDetail'])}</p>}
          {detail['geoDetail']  && <p className="truncate">📍 {String(detail['geoDetail'])}</p>}
        </div>
      )}

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
    </div>
  );
}
