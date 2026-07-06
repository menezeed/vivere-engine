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
 *   ✅ raio máximo em metros (Haversine simples)
 *   ✅ mesma cidade (comparação de string)
 *   ✅ proposal_status no conjunto permitido (já filtrado pelo Generator)
 *   ✅ limite máximo de candidatos (top N por proximidade geográfica)
 *
 * Critérios PROIBIDOS:
 *   ❌ similaridade de nome (tokens, trigrama, fuzzy)
 *   ❌ score de qualquer tipo
 *   ❌ overlap semântico de texto
 *   ❌ qualquer algoritmo de matching
 *
 * Se um critério requer comparar o texto da menção com o conteúdo do
 * candidato, pertence ao Matcher — não ao PreFilter.
 *
 * ORDEM DOS FILTROS (crescente de custo):
 *   1. Cidade (string compare — O(n), muito barato)
 *   2. Raio (Haversine — O(n), mais caro mas ainda simples)
 *   3. Top N por proximidade (sort — O(n log n), apenas sobre o que sobrou)
 */

import type { ICandidatePreFilter } from '../interfaces/index.js';
import type {
  CandidatePool,
  FilteredCandidates,
  VenueCandidate,
} from '../types/domain.js';
import type { CandidateSelectionConfig } from '../config/index.js';
import { haversineDistance, getCityCentroid } from '../utils/geo.js';
import { assertFilteredCandidates } from './contracts.js';

export class CandidatePreFilter implements ICandidatePreFilter {

  filter(pool: CandidatePool, config: CandidateSelectionConfig): FilteredCandidates {
    const original = pool.candidates;
    let filtered = [...original];
    const steps: string[] = [];

    // ── Passo 1: Filtro por cidade ──────────────────────────────────────────
    // Heurística barata — comparação de string normalizada.
    // Só aplicado quando allowCrossCity = false E existe uma cidade de referência.
    const referenceCity = this.resolveReferenceCity(pool);
    if (!config.allowCrossCity && referenceCity) {
      const before = filtered.length;
      filtered = filtered.filter(c =>
        !c.city || this.cityMatches(c.city, referenceCity),
      );
      const removed = before - filtered.length;
      if (removed > 0) steps.push(`${removed} removidos por cidade (ref: "${referenceCity}")`);
    }

    // ── Passo 2: Filtro por raio ────────────────────────────────────────────
    // Haversine simples — sem trigonometria complexa.
    // Só aplicado quando existe um ponto de referência geográfico.
    const referencePoint = this.resolveReferencePoint(pool);
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

    // ── Passo 3: Top N por proximidade ──────────────────────────────────────
    // Se ainda excede maxCandidates, ordena por proximidade e corta.
    // A ordenação usa distância ao ponto de referência — puramente geográfica.
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

  // ── Privados ──────────────────────────────────────────────────────────────

  /**
   * Resolve a cidade de referência para o filtro de cidade.
   * Usa a cidade da maioria dos candidatos (mais frequente) como referência.
   * Se não houver consenso claro, não filtra por cidade.
   */
  private resolveReferenceCity(pool: CandidatePool): string | null {
    // Pegar a cidade mais frequente entre os candidatos
    const cityCounts = new Map<string, number>();
    for (const c of pool.candidates) {
      if (c.city) {
        cityCounts.set(c.city, (cityCounts.get(c.city) ?? 0) + 1);
      }
    }
    if (cityCounts.size === 0) return null;

    // Usar a cidade mais frequente como referência
    let maxCity = '';
    let maxCount = 0;
    for (const [city, count] of cityCounts) {
      if (count > maxCount) { maxCount = count; maxCity = city; }
    }
    return maxCity || null;
  }

  /**
   * Resolve o ponto de referência geográfico.
   * Tenta o centroide da cidade de referência.
   */
  private resolveReferencePoint(
    pool: CandidatePool,
  ): { lat: number; lng: number } | null {
    const city = this.resolveReferenceCity(pool);
    if (!city) return null;
    return getCityCentroid(city);
  }

  /**
   * Compara duas cidades de forma normalizada.
   * "Cabo Frio RJ" === "cabo frio rj" → true
   */
  private cityMatches(candidateCity: string, referenceCity: string): boolean {
    return candidateCity.toLowerCase().trim() === referenceCity.toLowerCase().trim();
  }
}
