/**
 * entity-resolution/services/HumanResolutionService.ts
 *
 * Level 2, 2026-09-26 — Human Resolution.
 *
 * Conecta a infra-estrutura já existente e nunca ligada
 * (venue_resolution_decisions + VenueResolutionDecisionRepository.record(),
 * ActivityResolutionRepository.updateResolutionStatus()) para permitir a
 * confirmação humana de um candidato do Entity Resolution, sem alterar
 * proposal_status — essa continua a ser responsabilidade exclusiva do
 * ReviewService/ActivityReviewRepository já existente (fluxo separado).
 *
 * IResolutionReviewer (entity-resolution/interfaces/index.ts): este
 * serviço NÃO declara `implements IResolutionReviewer`. O método
 * accept() abaixo corresponde semanticamente a
 * IResolutionReviewer.accept() (confirmar um candidato explícito,
 * escolhido pelo revisor — a interface já não presume "o candidato
 * sugerido pelo motor" especificamente, aceita qualquer candidateId) —
 * mas override() e proposeNew() (os outros dois métodos da interface)
 * estão fora do âmbito desta implementação. Reivindicar o contrato
 * completo com métodos stub que lançam "not implemented" não seria
 * honesto; fica documentado aqui para quando os três métodos
 * existirem, altura em que `implements IResolutionReviewer` passa a
 * fazer sentido.
 */

import type { ActivityResolutionRepository } from '../repositories/impl/ActivityResolutionRepository.js';
import type {
  IVenueResolutionCandidateRepository,
  IVenueResolutionDecisionRepository,
} from '../repositories/interfaces.js';
import type { ActivityStagingId, VenueStagingId } from '../types/domain.js';
import {
  ActivityNotFoundError,
  InvalidResolutionStateError,
  CandidateNotInPoolError,
  DecisionConflictError,
} from '../errors/index.js';

export class HumanResolutionService {
  constructor(
    private readonly activityRepo:  ActivityResolutionRepository,
    private readonly candidateRepo: IVenueResolutionCandidateRepository,
    private readonly decisionRepo:  IVenueResolutionDecisionRepository,
  ) {}

  /**
   * Confirma candidateVenueId como o venue correcto de activityId, por
   * decisão humana. NÃO altera proposal_status — isso continua a ser
   * feito, depois, pelo fluxo normal de ReviewService.reviewActivity(...,
   * 'approve', ...).
   *
   * Precondições, todas verificadas antes de qualquer escrita:
   *   A. actividade existe;
   *   B. proposal_status === 'pending_review' (exactamente — não aceita
   *      approved/rejected/promoted nesta primeira versão);
   *   C. candidateVenueId pertence ao pool de candidatos gerado para
   *      esta actividade (VenueResolutionCandidateRepository.findByActivity);
   *   D. nenhuma regra adicional de validade além de C — o contrato
   *      actual (VenueCandidate/RankedCandidate) não tem nenhum campo de
   *      "candidato inválido" para além de pertencer ou não ao pool.
   *
   * Idempotência:
   *   — mesma actividade + mesmo candidato já confirmado antes → no-op,
   *     devolve normalmente, sem nova escrita;
   *   — mesma actividade + candidato DIFERENTE já confirmado antes →
   *     DecisionConflictError — override fica para um fluxo futuro,
   *     não implementado aqui.
   *
   * Ordem de escrita — decisão PRIMEIRO, depois activities_staging:
   * ver nota extensa junto à chamada abaixo.
   */
  async accept(
    activityId:        ActivityStagingId,
    candidateVenueId:  VenueStagingId,
    userId:            string,
    notes:             string | null = null,
  ): Promise<void> {
    // A. Actividade deve existir
    const activity = await this.activityRepo.findById(activityId);
    if (!activity) {
      throw new ActivityNotFoundError(activityId);
    }

    // B. proposal_status deve ser exactamente pending_review
    if (activity.proposal_status !== 'pending_review') {
      throw new InvalidResolutionStateError(
        activityId,
        activity.proposal_status ?? 'unknown',
        'human_resolution_accept',
      );
    }

    // C. candidato deve pertencer ao pool desta actividade — nunca
    // aceitar apenas que o venue UUID exista globalmente.
    const candidates = await this.candidateRepo.findByActivity(activityId);
    const candidate = candidates.find(c => c.candidateVenueId === candidateVenueId);
    if (!candidate) {
      throw new CandidateNotInPoolError(activityId, candidateVenueId);
    }

    // Idempotência — decisão humana anterior para esta actividade?
    // Comparação correcta: existingDecision.acceptedCandidateId é um
    // CandidateId (linha de venue_resolution_candidates), NUNCA um
    // VenueStagingId — comparar contra candidate.id, não candidateVenueId.
    const existingDecision = await this.decisionRepo.findLatest(activityId);
    if (existingDecision) {
      if (existingDecision.acceptedCandidateId === candidate.id) {
        return; // mesmo candidato já confirmado — idempotente, sem nova escrita
      }
      throw new DecisionConflictError(activityId, existingDecision.id);
    }

    // Ordem de escrita: decisão PRIMEIRO, depois updateResolutionStatus.
    //
    // Não existe abstracção de transacção partilhada entre
    // VenueResolutionDecisionRepository e ActivityResolutionRepository
    // (ambos fazem chamadas Supabase directas e independentes) — sem
    // construir infra-estrutura de transacção nova (fora do âmbito
    // desta mudança), a ordem em si é a única defesa disponível.
    //
    // Se a escrita da decisão for bem sucedida mas updateResolutionStatus
    // falhar a seguir: activities_staging fica com
    // venue_resolution_status='unresolved'/resolved_venue_staging_id=null
    // (inalterado), mas venue_resolution_decisions JÁ TEM a linha
    // registada. Nesse estado, uma futura execução de
    // EntityResolutionEngine.resolve() para esta actividade encontra
    // existingDecision via findLatest() logo no início — e devolve
    // 'unresolved' sem tocar em nada, SEM sobrescrever a decisão humana
    // com um resultado automático. Inconsistente (a actividade "parece"
    // por resolver, mas já tem decisão), mas seguro e visível — nunca
    // silenciosamente sobreposto pela automação.
    //
    // Se a ordem fosse invertida (updateResolutionStatus primeiro,
    // decisão depois, e a decisão falhasse): a actividade ficaria
    // 'matched' com resolved_venue_staging_id preenchido, mas SEM
    // nenhuma linha em venue_resolution_decisions — uma futura corrida
    // do Entity Resolution veria existingDecision === null e
    // RE-RESOLVERIA a actividade do zero, podendo sobrescrever a
    // confirmação humana com um resultado automático diferente. Este é
    // o cenário que a ordem escolhida evita.
    await this.decisionRepo.record(
      activity.product_key,
      activityId,
      'matched',
      candidate.id,
      userId,
      notes,
      false, // overrodeHighConfidence — esta v1 só aceita candidatos já
             // no pool tal como o Entity Resolution os pontuou; nunca
             // substitui um score alto por um baixo, então nunca é override
    );

    await this.activityRepo.updateResolutionStatus(
      activityId,
      'matched',
      candidateVenueId,
      candidate.score,
    );
  }
}
