/**
 * src/publishing/services/activityIdentity.ts
 *
 * Stable Source Activity Identity (Level 3, 2026-09-23).
 *
 * Deriva engine_activity_id de forma determinística a partir da identidade
 * estável de fonte (source_key, source_item_id) — não mais igual a
 * activities_staging.id (staging_id), que é efémero (novo em cada
 * ingestion_run, ver ADR sobre raw_activity_items append-only).
 *
 * Componente puro: sem acesso a banco, sem Date.now(), sem aleatoriedade.
 * Mesma entrada → sempre o mesmo UUID (RFC 4122 UUIDv5, determinístico por
 * desenho — ao contrário de v4, aleatório).
 *
 * NAMESPACE — permanente, nunca mudar depois da primeira publicação real
 * ==========================================================================
 * Gerado uma única vez, via uuidv5(DNS_NAMESPACE, 'vivere-engine.activity-identity'),
 * com o namespace DNS padrão do RFC 4122 (6ba7b810-9dad-11d1-80b4-00c04fd430c8).
 * O valor abaixo é o RESULTADO desse cálculo, hardcoded — não recalcular em
 * runtime. Mudar este valor muda a identidade de TODAS as activities já
 * publicadas pela Engine — só aceitável antes da primeira publicação real
 * (confirmado, Backfill Safety Audit de 2026-09-23: 0 de 48 public.activities
 * têm engine_activity_id não-nulo hoje — nenhuma publicação real da Engine
 * ainda aconteceu).
 */
const VIVERE_ACTIVITY_NAMESPACE = '72f123d8-74ac-55c2-9aa9-fe397133f4e9';

import { createHash } from 'node:crypto';

/**
 * UUIDv5 (RFC 4122) — SHA-1(namespace_bytes + name_bytes), com os bits de
 * versão/variante ajustados. Implementado com node:crypto (sem dependência
 * nova) em vez de uma biblioteca externa — decisão deliberada de menor
 * mudança (ver Level 3, 2026-09-23).
 */
function uuidv5(name: string, namespaceUuid: string): string {
  const namespaceBytes = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex');
  if (namespaceBytes.length !== 16) {
    throw new Error(`uuidv5: namespace inválido (esperado 16 bytes, recebeu ${namespaceBytes.length})`);
  }
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(Buffer.concat([namespaceBytes, nameBytes])).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // versão 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 4122

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Codificação canónica do input — decisão explícita (Level 3, 2026-09-23):
 * `${sourceKey}:${sourceItemId}`, sem normalização adicional. Risco aceite,
 * não eliminado: assume que nem sourceKey nem sourceItemId contêm ':' —
 * verdade em todos os valores reais observados nesta sessão (snake_case,
 * alfanumérico + '_'), mas não é uma garantia estrutural do schema.
 *
 * Função única, usada tanto em runtime (PublicationTransformer) quanto em
 * qualquer script de backfill futuro — nunca duas implementações da mesma
 * regra (decisão explícita do Level 3 review).
 */
export function deriveEngineActivityId(sourceKey: string, sourceItemId: string): string {
  return uuidv5(`${sourceKey}:${sourceItemId}`, VIVERE_ACTIVITY_NAMESPACE);
}
