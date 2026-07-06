/**
 * entity-resolution/matchers/GeoMatcher.ts
 *
 * Implementação do IGeoMatcher — matching por proximidade geográfica.
 *
 * PRINCÍPIOS:
 * — Função pura: sem acesso a banco, rede ou estado global.
 * — Retorna null quando não há coordenadas suficientes para calcular.
 * — O ponto de referência da actividade é o centroide da cidade
 *   (VenueMention não tem coordenadas — ADR-0003: nunca inventar).
 * — Score sempre em [0.0, 1.0].
 * — detail legível por humanos.
 *
 * QUANDO RETORNA null:
 *   — Candidato sem lat/lng
 *   — Sem ponto de referência disponível (cidade não reconhecida
 *     e sem coordenadas explícitas)
 *
 * QUANDO AMPLIFICA O NAMEMATCHER:
 *   — "Canto do Forte, na Praia do Forte" → NameMatcher score 0.63
 *     Praia do Forte está a 50m do centro de Cabo Frio → GeoScore 1.0
 *     Hybrid: (0.63×0.50) + (1.0×0.35) = 0.665 → muito melhor
 */

import type { IGeoMatcher } from '../interfaces/index.js';
import type { MatchScore, VenueCandidate } from '../types/domain.js';
import type { VenueMention } from '../../types/RawActivityItem.js';
import type { GeoPoint } from '../utils/geo.js';
import { geoScore, getCityCentroid, haversineDistance } from '../utils/geo.js';

// ── Configuração do GeoMatcher ────────────────────────────────────────────────

export interface GeoMatcherConfig {
  /**
   * Ponto de referência explícito para a actividade.
   * Quando fornecido, prevalece sobre o centroide da cidade.
   * Útil para testes e para quando o motor tiver geocodificação futura.
   */
  referencePoint?: GeoPoint;

  /**
   * Label da cidade da actividade (ex: "Cabo Frio RJ").
   * Usado para derivar o centroide quando não há referencePoint.
   */
  cityLabel?: string;
}

// ── GeoMatcher ────────────────────────────────────────────────────────────────

export class GeoMatcher implements IGeoMatcher {
  readonly id = 'geo' as const;

  private readonly cfg: GeoMatcherConfig;

  constructor(config: GeoMatcherConfig = {}) {
    this.cfg = config;
  }

  /**
   * Calcula o score de proximidade geográfica entre a actividade e o candidato.
   *
   * Retorna null se:
   *   — Candidato sem coordenadas
   *   — Sem ponto de referência (nem explícito nem centroide de cidade)
   *
   * Nunca lança — erros internos retornam null.
   */
  score(mention: VenueMention, candidate: VenueCandidate): MatchScore | null {
    try {
      // Candidato sem coordenadas — não é possível calcular geo score
      if (candidate.lat === null || candidate.lng === null) {
        return null;
      }

      const candidatePoint: GeoPoint = { lat: candidate.lat, lng: candidate.lng };

      // Resolver ponto de referência da actividade
      const reference = this.resolveReference(mention, candidate);
      if (!reference) {
        return null;
      }

      const { score, distanceMeters } = geoScore(reference, candidatePoint);
      const distanceLabel = this.formatDistance(distanceMeters);

      return {
        value:     score,
        method:    'geo',
        subMethod: 'haversine',
        detail:    `Distância: ${distanceLabel} do ponto de referência (${reference.lat.toFixed(4)}, ${reference.lng.toFixed(4)})`,
      };

    } catch {
      return null;
    }
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  /**
   * Resolve o ponto de referência para a actividade.
   * Prioridade:
   *   1. referencePoint explícito na configuração
   *   2. Centroide da cidade do candidato (city label persistido)
   *   3. cityLabel da configuração
   *   4. null (GeoMatcher retorna null)
   */
  private resolveReference(mention: VenueMention, candidate: VenueCandidate): GeoPoint | null {
    // 1. Referência explícita (testes, geocodificação futura)
    if (this.cfg.referencePoint) {
      return this.cfg.referencePoint;
    }

    // 2. Centroide da cidade do candidato (campo persistido — migration 0006)
    if (candidate.city) {
      const centroid = getCityCentroid(candidate.city);
      if (centroid) return centroid;
    }

    // 3. cityLabel da configuração
    if (this.cfg.cityLabel) {
      const centroid = getCityCentroid(this.cfg.cityLabel);
      if (centroid) return centroid;
    }

    return null;
  }

  private formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
  }
}

// ── Factories ────────────────────────────────────────────────────────────────

/** GeoMatcher com cidade explícita (uso típico no pipeline). */
export function createGeoMatcher(cityLabel?: string): GeoMatcher {
  return new GeoMatcher({ cityLabel });
}

/** GeoMatcher com ponto de referência explícito (testes e geocodificação futura). */
export function createGeoMatcherWithReference(reference: GeoPoint): GeoMatcher {
  return new GeoMatcher({ referencePoint: reference });
}
