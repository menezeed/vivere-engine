/**
 * entity-resolution/interfaces/index.ts
 *
 * Contratos públicos de todos os componentes do Entity Resolution Engine.
 *
 * PRINCÍPIO (ADR-0011, ADR-0012):
 * — Nenhuma interface conhece implementação concreta.
 * — Nenhuma interface importa Supabase, Hono ou qualquer framework.
 * — Matchers são funções puras: recebem dados, devolvem scores.
 * — O orquestrador recebe listas de interfaces — nunca instâncias concretas.
 *
 * Open/Closed: para adicionar um novo matcher, implementar IMatcher e
 * passar para o EntityResolutionEngine. Zero alterações nas interfaces existentes.
 *
 * Testabilidade: qualquer componente pode ser testado com dados sintéticos,
 * sem banco, sem rede, sem processo Node.js específico.
 */

import type {
  VenueCandidate,
  CandidatePool,
  FilteredCandidates,
  MatchScore,
  ScoredCandidates,
  RankedCandidates,
  ResolutionResult,
  ActivityStagingId,
  ResolutionRunSummary,
  TrustedCityContext,
} from '../types/domain.js';

import type { ERResult, BatchERResult } from '../types/result.js';

import type {
  CandidateSelectionConfig,
  ScoringConfig,
  ThresholdConfig,
  EntityResolutionConfig,
} from '../config/index.js';

import type { VenueMention } from '../../types/RawActivityItem.js';

// ── IMatcher — contrato base de todos os matchers ─────────────────────────

/**
 * Contrato base que todos os matchers implementam.
 *
 * Um matcher recebe um venue candidato e o contexto da menção,
 * e retorna um MatchScore ou null (quando o matcher não se aplica
 * ao contexto — ex: GeoMatcher sem coordenadas).
 *
 * NUNCA acede ao banco. NUNCA persiste. NUNCA conhece outros matchers.
 * É uma função pura com estado de configuração.
 */
export interface IMatcher {
  /** Identificador único do matcher — usado em logs e auditoria. */
  readonly id: string;

  /**
   * Calcula o score de similaridade entre uma menção e um candidato.
   * Retorna null quando o matcher não pode produzir um score útil
   * (ex: GeoMatcher sem coordenadas no candidato ou na menção).
   * Nunca lança — encapsula erros internos e retorna null.
   */
  score(mention: VenueMention, candidate: VenueCandidate): MatchScore | null;
}

// ── Interfaces específicas por método ─────────────────────────────────────
// Servem como marcadores de tipo e documentação de contrato.
// Um INameMatcher IS-A IMatcher — a distinção é semântica, não estrutural.

/** Matcher que calcula score baseado em similaridade de nome. */
export interface INameMatcher extends IMatcher {
  readonly id: 'name';
}

/** Matcher que calcula score baseado em proximidade geográfica. */
export interface IGeoMatcher extends IMatcher {
  readonly id: 'geo';
}

/** Matcher que calcula score baseado em similaridade de endereço. */
export interface IAddressMatcher extends IMatcher {
  readonly id: 'address';
}

// ── ICandidateGenerator ─────────────────────────────────────────────────

/**
 * Gera o pool bruto de candidatos para uma actividade.
 * Consulta venues_staging com proposal_status IN ('approved', 'promoted').
 * Não filtra. Não calcula scores. Apenas consulta e retorna.
 *
 * Level 2, 2026-09-26 — trustedCityContext acrescentado como parâmetro:
 * repassado directamente para o CandidatePool devolvido, para uso pelo
 * CandidatePreFilter — o Generator em si não o usa para filtrar nada.
 */
export interface ICandidateGenerator {
  generate(
    activityId: ActivityStagingId,
    mention: VenueMention | null,
    productKey: string,
    config: CandidateSelectionConfig,
    trustedCityContext?: TrustedCityContext | null,
  ): Promise<CandidatePool>;
}

// ── ICandidatePreFilter ─────────────────────────────────────────────────

/**
 * Reduz o pool de candidatos usando heurísticas baratas e configuráveis.
 * Opera em memória — sem acesso ao banco.
 *
 * REGRA ARQUITECTURAL INVIOLÁVEL (ajuste #4 do roadmap):
 * O CandidatePreFilter NUNCA contém inteligência semântica.
 *
 * Critérios PERMITIDOS (heurísticas estruturais/geográficas):
 *   raio máximo em metros (Haversine simples)
 *   cidade igual (identidade geográfica via contexto territorial confiável)
 *   categoria compatível (sobreposição de listas)
 *   product_key correcto
 *   proposal_status no conjunto permitido
 *   limite máximo de candidatos (top N por proximidade)
 *
 * Critérios PROIBIDOS (responsabilidade exclusiva dos Matchers):
 *   similaridade de nome (tokens, trigrama, fuzzy)
 *   score de qualquer tipo
 *   overlap semântico de texto
 *   qualquer algoritmo de matching
 *
 * Level 2, 2026-09-26: o filtro de cidade usa exclusivamente
 * CandidatePool.trustedCityContext — nunca deriva cidade da
 * distribuição/maioria do próprio candidate pool (comportamento
 * anterior, removido — era heurística de implementação, não
 * requisito de contrato, e causava exclusão incorrecta de candidatos
 * correctos quando o pool tinha mais candidatos de outra cidade).
 *
 * Se um critério requer comparar o texto da menção com o conteúdo
 * do candidato, pertence ao Matcher — não ao PreFilter.
 *
 * Output: FilteredCandidates com no máximo config.maxCandidates elementos.
 */
export interface ICandidatePreFilter {
  filter(
    pool: CandidatePool,
    config: CandidateSelectionConfig,
  ): FilteredCandidates;
}

// ── IHybridScoreCalculator ─────────────────────────────────────────────

/**
 * Agrega os scores parciais dos matchers com pesos configuráveis.
 * Aplica o confidence boost da VenueMention.
 * Produz o score final para cada candidato.
 */
export interface IHybridScoreCalculator {
  calculate(
    candidates: FilteredCandidates,
    matchers: readonly IMatcher[],
    config: ScoringConfig,
  ): ScoredCandidates;
}

// ── IThresholdClassifier ─────────────────────────────────────────────────

/**
 * Classifica os candidatos por score e determina o AutoClassification.
 * Aplica highConfidence e minSuggestion da ThresholdConfig.
 */
export interface IThresholdClassifier {
  classify(
    scored: ScoredCandidates,
    config: ThresholdConfig,
  ): RankedCandidates;
}

// ── IEntityResolutionEngine ─────────────────────────────────────────────

/**
 * Orquestrador do pipeline completo de Entity Resolution.
 *
 * Coordena: CandidateGenerator → CandidatePreFilter → Matchers →
 *           HybridScoreCalculator → ThresholdClassifier → Repositórios.
 *
 * Nunca calcula scores directamente.
 * Nunca acede ao banco directamente — delega para os repositórios.
 * Retorna sempre ERResult — nunca lança.
 */
export interface IEntityResolutionEngine {
  /**
   * Resolve a menção de venue de uma única actividade.
   * Idempotente: pode ser chamado múltiplas vezes para a mesma actividade.
   */
  resolve(
    activityId: ActivityStagingId,
    config?: Partial<EntityResolutionConfig>,
  ): Promise<ERResult>;

  /**
   * Resolve em batch todas as actividades unresolved de um produto.
   * Processa em sequência por defeito (paralelismo configurável no futuro).
   */
  resolveAll(
    productKey: string,
    config?: Partial<EntityResolutionConfig>,
  ): Promise<BatchERResult>;

  /**
   * Resolve uma lista específica de actividades.
   * Útil para reprocessamento selectivo.
   */
  resolveMany(
    activityIds: readonly ActivityStagingId[],
    config?: Partial<EntityResolutionConfig>,
  ): Promise<BatchERResult>;
}

// ── IResolutionReviewer ─────────────────────────────────────────────────

/**
 * Regista a decisão humana sobre os candidatos de uma actividade.
 * Chamado pelo Admin Panel (via Review API) — não pelo motor.
 */
export interface IResolutionReviewer {
  /** Confirmar o candidato sugerido pelo motor. */
  accept(
    activityId: ActivityStagingId,
    candidateId: string,
    userId: string,
    notes?: string,
  ): Promise<void>;

  /** Escolher um candidato diferente do sugerido. */
  override(
    activityId: ActivityStagingId,
    candidateId: string,
    userId: string,
    notes: string,
  ): Promise<void>;

  /** Marcar como venue novo — nenhum candidato é o correcto. */
  proposeNew(
    activityId: ActivityStagingId,
    userId: string,
    notes?: string,
  ): Promise<void>;
}
