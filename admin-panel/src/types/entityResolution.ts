// admin-panel/src/types/entityResolution.ts

export type ERStatus =
  | 'matched'
  | 'ambiguous'
  | 'unresolved'
  | 'proposed_new';

export interface ERQueueItem {
  activityId:             string;
  productKey:             string;
  title:                  string | null;
  venueMentionText:       string | null;
  venueMentionHint:       string | null;
  venueResolutionStatus:  ERStatus;
  resolutionConfidence:   number | null;
  topCandidateName:       string | null;
  candidateCount:         number;
  createdAt:              string;
}

export interface ERCandidate {
  id:                   string;
  candidateVenueId:     string;
  venueName:            string;
  venueCity:            string | null;
  venueLat:             number | null;
  venueLng:             number | null;
  score:                number;
  nameScore:            number | null;
  geoScore:             number | null;
  addressScore:         number | null;
  autoClassification:   string;
  decisionOutcome:      string | null;
  matchDetail:          Record<string, unknown> | null;
  rank:                 number;
}

export interface ERStats {
  total:        number;
  matched:      number;
  ambiguous:    number;
  unresolved:   number;
  proposed_new: number;
  no_mention:   number;
  decided:      number;
}

// Ordem de prioridade para exibição na fila
export const ER_STATUS_PRIORITY: Record<ERStatus, number> = {
  ambiguous:    0,
  matched:      1,
  unresolved:   2,
  proposed_new: 3,
};

export const ER_STATUS_LABEL: Record<ERStatus, string> = {
  matched:      'Identificado',
  ambiguous:    'Ambíguo',
  unresolved:   'Não resolvido',
  proposed_new: 'Venue novo',
};

export const ER_STATUS_COLOR: Record<ERStatus, string> = {
  matched:      'bg-green-100 text-green-700',
  ambiguous:    'bg-amber-100 text-amber-700',
  unresolved:   'bg-blue-100 text-blue-700',
  proposed_new: 'bg-gray-100 text-gray-600',
};
