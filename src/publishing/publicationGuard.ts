/**
 * Bloqueio de publicação internacional (piloto UK, 26/11/2026).
 *
 * A publicação converte as horas locais das fontes com um deslocamento
 * fixo do Brasil (SOURCE_LOCAL_UTC_OFFSET = '-03:00', occurrenceSelection.ts)
 * e a vista active_activities usa America/Sao_Paulo (0029). Publicar um
 * produto de outro país gravaria horas erradas. Até U8 (fuso por região)
 * estar implementado e validado, só os produtos desta allowlist podem ser
 * publicados — qualquer outro é recusado ANTES de qualquer escrita.
 *
 * Remover um produto desta lista NÃO é suficiente para o desbloquear:
 * U8 tem de substituir o deslocamento fixo primeiro.
 */
export const PUBLISHABLE_PRODUCT_KEYS: ReadonlySet<string> = new Set(['vivere-60-mais']);

export class InternationalPublicationBlockedError extends Error {
  constructor(productKey: string) {
    super(
      `publicação recusada para o produto "${productKey}": só ${[...PUBLISHABLE_PRODUCT_KEYS].join(', ')} ` +
        'pode ser publicado até U8 (fuso horário por região) estar implementado e validado',
    );
    this.name = 'InternationalPublicationBlockedError';
  }
}

export function assertPublishableProduct(productKey: string): void {
  if (!PUBLISHABLE_PRODUCT_KEYS.has(productKey)) throw new InternationalPublicationBlockedError(productKey);
}
