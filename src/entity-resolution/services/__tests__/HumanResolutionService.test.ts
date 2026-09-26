/**
 * entity-resolution/services/__tests__/HumanResolutionService.test.ts
 *
 * Level 2, 2026-09-26 — Human Resolution. Cobertura dos casos A-M
 * aprovados. Zero dependências externas — repositórios mockados.
 */

import { describe, it, expect, vi } from 'vitest';
import { HumanResolutionService } from '../HumanResolutionService';
import {
  ActivityNotFoundError,
  InvalidResolutionStateError,
  CandidateNotInPoolError,
  DecisionConflictError,
} from '../../errors/index';
import type { ActivityResolutionRepository, ActivityForResolution } from '../../repositories/impl/ActivityResolutionRepository';
import type { IVenueResolutionCandidateRepository, IVenueResolutionDecisionRepository } from '../../repositories/interfaces';

const ACT_ID = 'activity-984da332' as any;
const CANDIDATE_VENUE_ID = 'venue-canto-do-forte' as any;
const OTHER_VENUE_ID = 'venue-outra-cidade' as any;
const CANDIDATE_ROW_ID = 'candidate-row-001' as any;
const USER_ID = 'reviewer-eduardo';

function makeActivity(overrides: Partial<ActivityForResolution> = {}): ActivityForResolution {
  return {
    id: ACT_ID,
    product_key: 'vivere-60-mais',
    venue_resolution_status: 'unresolved',
    venue_mention: { raw_text: 'Canto do Forte, na Praia do Forte', raw_address_text: null, confidence_hint: 'explicit_name' },
    source_key: 'prefeitura_cabo_frio',
    proposal_status: 'pending_review',
    ...overrides,
  };
}

function makeCandidateRow(overrides: Partial<{ id: any; candidateVenueId: any; score: number }> = {}) {
  return {
    id: CANDIDATE_ROW_ID,
    candidateVenueId: CANDIDATE_VENUE_ID,
    score: 0.7606,
    nameScore: 0.633,
    geoScore: 0.70,
    addressScore: null,
    autoClassification: 'unresolved',
    decisionOutcome: null,
    ...overrides,
  };
}

function makeMocks(opts: {
  activity?: ActivityForResolution | null;
  candidates?: ReturnType<typeof makeCandidateRow>[];
  existingDecision?: any;
  updateResolutionStatusImpl?: () => Promise<void>;
  recordImpl?: () => Promise<any>;
} = {}) {
  const activityRepo = {
    findById: vi.fn().mockResolvedValue(opts.activity === undefined ? makeActivity() : opts.activity),
    updateResolutionStatus: vi.fn(opts.updateResolutionStatusImpl ?? (() => Promise.resolve())),
  } as unknown as ActivityResolutionRepository;

  const candidateRepo = {
    findByActivity: vi.fn().mockResolvedValue(opts.candidates ?? [makeCandidateRow()]),
  } as unknown as IVenueResolutionCandidateRepository;

  const decisionRepo = {
    record: vi.fn(opts.recordImpl ?? (() => Promise.resolve('decision-001'))),
    findLatest: vi.fn().mockResolvedValue(opts.existingDecision ?? null),
  } as unknown as IVenueResolutionDecisionRepository;

  return { activityRepo, candidateRepo, decisionRepo };
}

describe('HumanResolutionService.accept', () => {
  it('A. pending_review + candidate válido → matched, venue correcto, confidence usa score do candidate, decisão registada', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks();
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID, 'confirmado, mesmo nome e cidade');

    expect(decisionRepo.record).toHaveBeenCalledWith(
      'vivere-60-mais', ACT_ID, 'matched', CANDIDATE_ROW_ID, USER_ID, 'confirmado, mesmo nome e cidade', false,
    );
    expect(activityRepo.updateResolutionStatus).toHaveBeenCalledWith(
      ACT_ID, 'matched', CANDIDATE_VENUE_ID, 0.7606,
    );
  });

  it('B. candidate não pertence ao pool da Activity → rejeita, nenhuma escrita', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ candidates: [makeCandidateRow()] });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, OTHER_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(CandidateNotInPoolError);
    expect(decisionRepo.record).not.toHaveBeenCalled();
    expect(activityRepo.updateResolutionStatus).not.toHaveBeenCalled();
  });

  it('C. candidate pertence ao pool de OUTRA Activity (não aparece no pool desta) → rejeita, nenhuma escrita', async () => {
    // findByActivity(ACT_ID) só devolve candidatos DESTA actividade — um
    // venue candidato de outra actividade nunca aparece aqui, mesmo que
    // exista globalmente. Mesmo mecanismo de protecção que o caso B.
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ candidates: [makeCandidateRow()] });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, OTHER_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(CandidateNotInPoolError);
    expect(decisionRepo.record).not.toHaveBeenCalled();
  });

  it('D. Activity inexistente → rejeita', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ activity: null });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(ActivityNotFoundError);
    expect(candidateRepo.findByActivity).not.toHaveBeenCalled();
    expect(decisionRepo.record).not.toHaveBeenCalled();
  });

  it('E. proposal_status = approved → rejeita', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ activity: makeActivity({ proposal_status: 'approved' }) });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(InvalidResolutionStateError);
    expect(decisionRepo.record).not.toHaveBeenCalled();
  });

  it('F. proposal_status = rejected → rejeita', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ activity: makeActivity({ proposal_status: 'rejected' }) });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(InvalidResolutionStateError);
  });

  it('G. proposal_status = promoted → rejeita', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ activity: makeActivity({ proposal_status: 'promoted' }) });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(InvalidResolutionStateError);
  });

  it('H. decisão humana anterior para o MESMO candidate → idempotente, sem nova escrita', async () => {
    const existingDecision = { id: 'decision-existing', acceptedCandidateId: CANDIDATE_ROW_ID };
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ existingDecision });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).resolves.toBeUndefined();
    expect(decisionRepo.record).not.toHaveBeenCalled();
    expect(activityRepo.updateResolutionStatus).not.toHaveBeenCalled();
  });

  it('I. decisão humana anterior para candidate DIFERENTE → rejeita, nenhuma escrita (override fica para fluxo futuro)', async () => {
    const existingDecision = { id: 'decision-existing', acceptedCandidateId: 'outro-candidate-row-id' };
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ existingDecision });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toBeInstanceOf(DecisionConflictError);
    expect(decisionRepo.record).not.toHaveBeenCalled();
    expect(activityRepo.updateResolutionStatus).not.toHaveBeenCalled();
  });

  it('J. score usado vem do candidate repository, nunca do caller (accept() nem tem parâmetro de score)', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({ candidates: [makeCandidateRow({ score: 0.9123 })] });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID);

    expect(activityRepo.updateResolutionStatus).toHaveBeenCalledWith(
      ACT_ID, 'matched', CANDIDATE_VENUE_ID, 0.9123,
    );
  });

  it('K. proposal_status NÃO muda — updateResolutionStatus nunca recebe nem escreve proposal_status', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks();
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID);

    const call = (activityRepo.updateResolutionStatus as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call).toHaveLength(4); // activityId, classification, resolvedVenueId, confidenceScore — nada de proposal_status
  });

  it('L. falha na escrita da decisão → propaga o erro, updateResolutionStatus NUNCA é chamado (ordem decisão-primeiro)', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({
      recordImpl: () => Promise.reject(new Error('falha simulada de rede')),
    });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toThrow('falha simulada de rede');
    expect(activityRepo.updateResolutionStatus).not.toHaveBeenCalled();
  });

  it('L (continuação). falha em updateResolutionStatus APÓS decisão já registada → decisão permanece gravada, erro propaga', async () => {
    const { activityRepo, candidateRepo, decisionRepo } = makeMocks({
      updateResolutionStatusImpl: () => Promise.reject(new Error('falha simulada na segunda escrita')),
    });
    const service = new HumanResolutionService(activityRepo, candidateRepo, decisionRepo);

    await expect(service.accept(ACT_ID, CANDIDATE_VENUE_ID, USER_ID)).rejects.toThrow('falha simulada na segunda escrita');
    // A decisão FOI chamada e teria sido persistida antes da falha —
    // este é o estado "inconsistente mas seguro" documentado no serviço.
    expect(decisionRepo.record).toHaveBeenCalledTimes(1);
  });

  it('M. nenhuma alteração de thresholds/weights/scoring — o serviço não importa config de scoring nenhuma', async () => {
    // Verificação estrutural: o módulo do serviço não importa
    // DEFAULT_SCORING, DEFAULT_THRESHOLDS, nem qualquer coisa de
    // entity-resolution/config — só repositórios e erros.
    const serviceSource = HumanResolutionService.toString();
    expect(serviceSource).not.toContain('DEFAULT_SCORING');
    expect(serviceSource).not.toContain('DEFAULT_THRESHOLDS');
  });
});
