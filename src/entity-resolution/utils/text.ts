/**
 * entity-resolution/utils/text.ts
 *
 * TextNormalizer — normalização de texto para Entity Resolution.
 *
 * PRINCÍPIOS:
 * — Zero dependências externas. Funciona em qualquer ambiente Node.js.
 * — Suporte a pt-BR e en-GB via listas de stopwords configuráveis.
 * — Resultado determinístico — mesma entrada sempre produz mesma saída.
 * — Cada etapa é testável isoladamente.
 *
 * PIPELINE de normalização:
 *   1. Lowercase
 *   2. Remoção de diacríticos (acentos)
 *   3. Remoção de pontuação e caracteres especiais
 *   4. Colapso de espaços múltiplos
 *   5. Remoção de stopwords (opcional, configurável)
 *   6. Trim
 */

// ── Stopwords por idioma ──────────────────────────────────────────────────────

export const STOPWORDS_PT_BR = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'da', 'de', 'do', 'das', 'dos', 'du',
  'na', 'no', 'nas', 'nos',
  'em', 'ao', 'aos', 'à', 'às',
  'e', 'ou', 'mas', 'por', 'para', 'com', 'sem', 'sob',
  'que', 'se', 'na', 'ne',
]);

export const STOPWORDS_EN_GB = new Set([
  'a', 'an', 'the',
  'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from',
  'and', 'or', 'but', 'nor',
  'is', 'are', 'was', 'were',
]);

// ── Opções de normalização ────────────────────────────────────────────────────

export interface NormalizeOptions {
  /** Remover stopwords. Default: true. */
  removeStopwords?: boolean;
  /** Conjunto de stopwords a usar. Default: STOPWORDS_PT_BR. */
  stopwords?: ReadonlySet<string>;
}

const DEFAULT_OPTIONS: Required<NormalizeOptions> = {
  removeStopwords: true,
  stopwords:       STOPWORDS_PT_BR,
};

// ── Funções individuais (testáveis isoladamente) ──────────────────────────────

/** Remove diacríticos/acentos: "José" → "jose", "São" → "sao". */
export function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Remove pontuação e caracteres especiais, mantendo letras, números e espaços. */
export function removePunctuation(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
}

/** Colapsa múltiplos espaços em um único. */
export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Tokeniza um texto normalizado em array de tokens. */
export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(t => t.length > 0);
}

// ── Normalização completa ─────────────────────────────────────────────────────

/**
 * Normaliza um texto para comparação.
 * Resultado: string lowercase, sem acentos, sem pontuação,
 * sem stopwords (opcional), espaços colapsados.
 *
 * Exemplos pt-BR:
 *   "Museu José de Dome"              → "museu jose dome"
 *   "Canto do Forte, na Praia do Forte" → "canto forte praia forte"
 *   "Cidade do Idoso (SEPIES)"        → "cidade idoso sepies"
 *
 * Exemplos en-GB:
 *   "Richmond Town Hall"              → "richmond town hall"  (sem stopwords)
 *   "The Old Deer Park"               → "old deer park"       (remove 'the')
 */
export function normalize(text: string, opts: NormalizeOptions = {}): string {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  let result = text.toLowerCase();
  result = removeDiacritics(result);
  result = removePunctuation(result);
  result = collapseSpaces(result);

  if (options.removeStopwords && options.stopwords) {
    const tokens = tokenize(result);
    const filtered = tokens.filter(t => !options.stopwords!.has(t));
    // Preservar pelo menos 1 token se todos forem stopwords
    result = (filtered.length > 0 ? filtered : tokens).join(' ');
  }

  return result;
}

/** Normaliza e tokeniza num único passo. */
export function normalizeAndTokenize(text: string, opts: NormalizeOptions = {}): string[] {
  return tokenize(normalize(text, opts));
}

// ── Trigram ───────────────────────────────────────────────────────────────────

/**
 * Gera os trigramas de um texto.
 * Padding com espaços no início e fim (padrão pg_trgm).
 *
 * Ex: "cat" → {" ca", "cat", "at "}
 * Ex: "ab"  → {" ab", "ab "}  (bigrama tratado como trigrama com padding)
 */
export function trigrams(text: string): Set<string> {
  const padded = ` ${text} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Similaridade trigram entre dois textos (0.0 – 1.0).
 * Fórmula: 2 × |intersecção| / (|A| + |B|)
 * Compatível com o algoritmo do pg_trgm do PostgreSQL.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tA = trigrams(a);
  const tB = trigrams(b);
  if (tA.size === 0 || tB.size === 0) return 0;

  let intersection = 0;
  for (const t of tA) {
    if (tB.has(t)) intersection++;
  }

  return (2 * intersection) / (tA.size + tB.size);
}

// ── Jaccard ───────────────────────────────────────────────────────────────────

/**
 * Similaridade Jaccard entre dois conjuntos de tokens (0.0 – 1.0).
 * Fórmula: |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
