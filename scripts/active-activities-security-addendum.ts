/**
 * scripts/active-activities-security-addendum.ts
 *
 * Activity 16/26, Fase 16D. Extensão a security-rls-validation.ts —
 * testa INSERT/UPDATE/DELETE via public.active_activities (view,
 * security_invoker=true), nunca testado antes (Activity 15 só testou
 * public.activities directamente).
 *
 * Achado motivador (16C.4): active_activities tem GRANT INSERT/UPDATE/
 * DELETE/TRUNCATE a anon/authenticated em produção, nunca confirmado
 * empiricamente como realmente bloqueado pela RLS+trigger da tabela
 * base. Este script fecha essa lacuna de validação.
 *
 * Integrar como funções adicionais dentro de security-rls-validation.ts
 * (mesmo ficheiro, mesma fixture, mesmo padrão CREATE→TEST→VERIFY→
 * CLEANUP) — apresentado aqui em separado só para revisão focada.
 *
 * NUNCA correr contra produção sem autorização explícita — mesmas
 * regras do harness principal.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface TestResult {
  readonly name: string;
  readonly expected: 'ALLOWED' | 'DENIED';
  readonly actual: 'ALLOWED' | 'DENIED' | 'ERROR';
  readonly detail?: string;
}

/**
 * Tenta INSERT via active_activities como sessão não-privilegiada.
 * Verifica DOIS aspectos, conforme exigido (16D, Parte 9):
 *   1. a operação é negada (ou não produz nenhuma linha nova);
 *   2. nenhuma linha nova aparece em public.activities (tabela base),
 *      confirmado via serviceClient.
 */
export async function testActiveActivitiesInsert(
  client: SupabaseClient,
  serviceClient: SupabaseClient,
  marker: string,
): Promise<TestResult> {
  const { data, error } = await client
    .from('active_activities')
    .insert({ title: `${marker} — via view, nunca deve persistir` })
    .select('id')
    .maybeSingle();

  // Verificação 2 — independente do que 'error'/'data' digam, confirma
  // directamente na tabela base se alguma linha com este título existe.
  const { data: baseRows } = await serviceClient
    .from('activities')
    .select('id')
    .ilike('title', `${marker}%`);

  if (baseRows && baseRows.length > 0) {
    // Nunca deixar vestígio, mesmo que o teste tenha "falhado" ao
    // confirmar protecção.
    await serviceClient.from('activities').delete().ilike('title', `${marker}%`);
  }

  const leaked = Boolean(data?.id) || Boolean(baseRows && baseRows.length > 0);
  return {
    name: 'authenticated INSERT via active_activities',
    expected: 'DENIED',
    actual: leaked ? 'ALLOWED' : 'DENIED',
    detail: error?.message,
  };
}

/** Idêntico em espírito para UPDATE — tenta mudar um campo protegido via a view. */
export async function testActiveActivitiesUpdate(
  client: SupabaseClient,
  serviceClient: SupabaseClient,
  fixtureId: string,
): Promise<TestResult> {
  const attemptValue = `VIA_VIEW_ATTEMPT_${Date.now()}`;
  await client.from('active_activities').update({ title: attemptValue }).eq('id', fixtureId);

  const { data: actual } = await serviceClient
    .from('activities')
    .select('title')
    .eq('id', fixtureId)
    .single();

  const changed = actual?.title === attemptValue;
  return {
    name: 'authenticated UPDATE via active_activities',
    expected: 'DENIED',
    actual: changed ? 'ALLOWED' : 'DENIED',
    detail: changed ? 'linha base realmente mudou via view' : 'linha base confirmada inalterada',
  };
}

/** Idêntico em espírito para DELETE. */
export async function testActiveActivitiesDelete(
  client: SupabaseClient,
  serviceClient: SupabaseClient,
  fixtureId: string,
): Promise<TestResult> {
  await client.from('active_activities').delete().eq('id', fixtureId);

  const { data: stillThere } = await serviceClient
    .from('activities')
    .select('id')
    .eq('id', fixtureId)
    .maybeSingle();

  return {
    name: 'authenticated DELETE via active_activities',
    expected: 'DENIED',
    actual: stillThere ? 'DENIED' : 'ALLOWED',
  };
}
