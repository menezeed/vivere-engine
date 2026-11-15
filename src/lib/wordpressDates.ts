/**
 * src/lib/wordpressDates.ts
 *
 * A WordPress REST API devolve `date_gmt` SEM designador de fuso
 * (ex.: "2026-06-30T23:30:00"), mas o valor é UTC por definição.
 * `new Date("2026-06-30T23:30:00")` interpreta-o como HORA LOCAL da
 * máquina (ECMAScript: data-hora ISO sem fuso = hora local), o que
 * desloca o instante em ±N horas e pode mudar o dia, o mês e até o ano
 * de referência perto da viragem.
 *
 * Esta função faz só a interpretação mecânica correcta (ADR-0001): não
 * corrige nem adivinha nada (ADR-0003). Se a string já trouxer fuso
 * ("Z" ou "±hh:mm"), é respeitado; se for inválida, devolve uma Date
 * inválida, exactamente como `new Date()` já fazia.
 */
const HAS_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_DATE_TIME_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function parseWordPressGmtDate(dateGmt: string): Date {
  const value = dateGmt.trim();
  if (HAS_TIMEZONE.test(value)) return new Date(value);
  if (ISO_DATE_TIME_WITHOUT_ZONE.test(value)) return new Date(`${value}Z`);
  return new Date(value);
}
