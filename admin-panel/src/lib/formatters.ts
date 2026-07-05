/**
 * Utilitários de formatação partilhados.
 * Centralizado aqui para que qualquer mudança de formato ou localização
 * seja feita num único sítio.
 */

/** Tempo relativo em português — "agora", "5m atrás", "3h atrás", "2d atrás" */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'agora';
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

/** Data no formato pt-BR: "04/07/2026" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

/** Data e hora no formato pt-BR: "04/07/2026, 22:34" */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('pt-BR');
}

/** Valor em USD: "$3.48" */
export function formatUSD(value: number): string {
  return `$${value.toFixed(2)}`;
}
