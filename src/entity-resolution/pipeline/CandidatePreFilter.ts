/**
 * entity-resolution/pipeline/CandidatePreFilter.ts
 *
 * Implementação do ICandidatePreFilter.
 *
 * RESPONSABILIDADE ÚNICA:
 * Reduzir o pool de candidatos usando heurísticas baratas e estruturais.
 * Opera em memória. Sem acesso ao banco. Sem scores. Sem algoritmos de matching.
 *
 * REGRA ARQUITECTURAL INVIOLÁVEL (ADR-0012, ajuste #4 do roadmap):
 *
 * Critérios PERMITIDOS:
 *   raio máximo em metros (Haversine simples)
 *   mesma cidade (identidade geográfica, ver Level 2 abaixo)
 *   proposal_status no conjunto permitido (já filtrado pelo Generator)
 *   limite máximo de candidatos (top N por proximidade geográfica)
 *
 * Critérios PROIBIDOS:
 *   similaridade de nome (tokens, trigrama, fuzzy)
 *   score de qualquer tipo
 *   overlap semântico de texto
 *   qualquer algoritmo de matching
 *
 * Se um critério requer comparar o texto da menção com o conteúdo do
 * candidato, pertence ao Matcher — não ao PreFilter.
 *
 * ORDEM DOS FILTROS (crescente de custo):
 *   1. Cidade (identidade via centróide — O(n), barato)
 *   2. Raio (Haversine — O(n), mais caro mas ainda simples)
 *   3. Top N por proximidade (sort — O(n log n), apenas sobre o que sobrou)
 *
 * CORRECÇÃO ESTRUTURAL (Level 2, 2026-09-26) — root cause do caso
 * real "Canto do Forte" (Activity Lote Zero, staging_id
 * 984da332-9f15-456e-a35f-2aa6f29abefe). Antes desta correcção, a
 * "cidade de referência" era derivada pela CIDADE MAIS FREQUENTE
 * ENTRE OS PRÓPRIOS CANDIDATOS DO POOL — sem nenhuma ligação à
 * activity real. Num pool multi-cidade (Iguaba Grande: 28 candidatos
 * promoted, Cabo Frio: 21), isto elegeu "Iguaba Grande RJ" como
 * referência para uma activity de Cabo Frio, eliminando o venue
 * correcto ("Canto do Forte", city=Cabo Frio RJ) antes de qualquer
 * scoring de nome/geografia acontecer. Era heurística de
 * implementação, sem nenhum ADR a exigi-la (confirmado por
 * investigação: git grep vazio em docs/adr/).
 *
 * Correcção: a cidade de referência vem exclusivamente de
 * CandidatePool.trustedCityContext — contexto territorial confiável
 * da própria Activity (derivado da configuração da fonte, nunca do
 * candidate pool, nunca do texto da menção). Quando ausente
 * (trustedCityContext === null), NENHUM filtro geográfico é aplicado
 * — nem cidade, nem raio, nem ordenação por proximidade — apenas
 * maxCandidates continua obrigatório. A ausência de contexto
 * geográfico confiável reduz a precisão do PreFilter; nunca inventa
 * contexto artificial.
 *
 * Identidade de cidade (não substring, não lista de variantes
 * hardcoded): reaproveita getCityCentroid() — já usado pelo
 * GeoMatcher — como função de canonicalização. "Cabo Frio" e
 * "Cabo Frio RJ" resolvem ao MESMO GeoPoint em CITY_CENTROIDS
 * (entradas duplicadas e equivalentes já existentes); duas cidades
 * com o mesmo ponto são consideradas a mesma identidade. Cidades
 * ainda não presentes em CITY_CENTROIDS (ex: fontes futuras de São
 * Paulo) resolvem a null em ambos os lados — nesse caso, nunca
 * corresponde (comportamento conservador, nunca "quase-match" por
 * substring).
 */

import type { ICandidatePreFilter } from '../interfaces/index.js';
import type {
  CandidatePool,
  FilteredCandidates,
  VenueCandidate,
  TrustedCityContext,
} from '../types/domain.js';
import type { CandidateSelectionConfig } from '../config/index.js';
import { haversineDistance, getCityCentroid, type GeoPoint } from '../utils/geo.js';
import { assertFilteredCandidates } from './contracts.js';

export class CandidatePreFilter implements ICandidatePreFilter {

  filter(pool: CandidatePool, config: CandidateSelectionConfig): FilteredCandidates {
    const original = pool.candidates;
    let filtered = [...original];
    const steps: string[] = [];

    const trustedCityContext = pool.trustedCityContext;

    // ── Passo 1: Filtro por cidade ──────────────────────────────────────
    // Level 2, 2026-09-26 — só aplicado com trustedCityContext presente.
    // Nunca deriva cidade do candidate pool (ver nota no cabeçalho).
    if (!config.allowCrossCity && trustedCityContext) {
      const before = filtered.length;
      filtered = filtered.filter(c =>
        !c.city || this.citiesMatch(c.city, trustedCityContext),
      );
      const removed = before - filtered.length;
      if (removed > 0) {
        steps.push(`${removed} removidos por cidade (trusted: "${trustedCityContext.city}, ${trustedCityContext.state}")`);
      }
    }

    // ── Passo 2: Filtro por raio ─────────────────────────────────────────
    // Só aplicado quando há um ponto de referência confiável, derivado
    // exclusivamente de trustedCityContext — nunca da maioria do pool.
    const referencePoint = this.resolveTrustedReferencePoint(trustedCityContext);
    if (referencePoint && config.maxRadiusMeters > 0) {
      const before = filtered.length;
      filtered = filtered.filter(c => {
        if (c.lat === null || c.lng === null) return true; // sem coords → não eliminar
        const dist = haversineDistance(referencePoint, { lat: c.lat, lng: c.lng });
        return dist.meters <= config.maxRadiusMeters;
      });
      const removed = before - filtered.length;
      if (removed > 0) steps.push(`${removed} removidos por raio (${config.maxRadiusMeters}m)`);
    }

    // ── Passo 3: Top N por proximidade ──────────────────────────────────
    // Se ainda excede maxCandidates, ordena por proximidade e corta —
    // só quando há referencePoint confiável. Sem contexto territorial,
    // maxCandidates continua obrigatório, mas sem ordenação por uma
    // cidade inventada — apenas corta na ordem em que os candidatos
    // chegaram.
    if (filtered.length > config.maxCandidates) {
      if (referencePoint) {
        filtered.sort((a, b) => {
          const distA = (a.lat !== null && a.lng !== null)
            ? haversineDistance(referencePoint, { lat: a.lat, lng: a.lng }).meters
            : Infinity;
          const distB = (b.lat !== null && b.lng !== null)
            ? haversineDistance(referencePoint, { lat: b.lat, lng: b.lng }).meters
            : Infinity;
          return distA - distB;
        });
      }
      const before = filtered.length;
      filtered = filtered.slice(0, config.maxCandidates);
      steps.push(`${before - filtered.length} removidos por limite (maxCandidates=${config.maxCandidates})`);
    }

    const filteredCount = original.length - filtered.length;
    const reasoning = steps.length > 0
      ? steps.join('; ')
      : `${filtered.length} de ${original.length} candidatos (sem filtros aplicados)`;

    const result: FilteredCandidates = {
      activityId:      pool.activityId,
      venueMention:    pool.venueMention,
      candidates:      filtered,
      filteredCount,
      originalCount:   original.length,
      filterReasoning: reasoning,
    };

    // Invariante do pipeline
    assertFilteredCandidates(result, config.maxCandidates);

    return result;
  }

  // ── Privados ──────────────────────────────────────────────────────────

  /**
   * Level 2, 2026-09-26 — ponto de referência confiável, derivado
   * exclusivamente de trustedCityContext.city via getCityCentroid().
   * null quando não há contexto territorial confiável, ou quando a
   * cidade declarada não está (ainda) em CITY_CENTROIDS — em ambos os
   * casos, nenhum filtro de raio/ordenação por proximidade é aplicado
   * (comportamento conservador, nunca inventa).
   */
  private resolveTrustedReferencePoint(
    trustedCityContext: TrustedCityContext | null | undefined,
  ): GeoPoint | null {
    if (!trustedCityContext) return null;
    return getCityCentroid(trustedCityContext.city);
  }

  /**
   * Level 2, 2026-09-26 — identidade de cidade via canonicalização por
   * centróide, não substring/includes(). "Cabo Frio" (trustedCityContext,
   * sem sufixo de estado) e "Cabo Frio RJ" (candidate.city) resolvem ao
   * MESMO GeoPoint em CITY_CENTROIDS (entradas duplicadas já existentes
   * para as cidades RJ suportadas) — considerados a mesma cidade.
   *
   * Se qualquer um dos dois lados não estiver em CITY_CENTROIDS,
   * devolve false (nunca corresponde por acaso) — nunca usa
   * comparação textual como fallback.
   */
  private citiesMatch(candidateCity: string, trustedCityContext: TrustedCityContext): boolean {
    const trustedPoint   = getCityCentroid(trustedCityContext.city);
    const candidatePoint = getCityCentroid(candidateCity);
    if (!trustedPoint || !candidatePoint) return false;
    return trustedPoint.lat === candidatePoint.lat && trustedPoint.lng === candidatePoint.lng;
  }
}
