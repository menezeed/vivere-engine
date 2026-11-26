/**
 * Verificação SÓ DE LEITURA do ambiente de staging (piloto UK).
 *
 *   npx tsx --env-file=<ficheiro de staging> scripts/check-staging-env.ts
 *
 * 1. Corre o envGuard e mostra ambiente, project ref, formato da chave e se a
 *    associação chave↔projecto foi verificada (nunca imprime a chave nem o URL
 *    completo com credenciais).
 * 2. Prova a associação com UMA leitura real ao staging (contagem head-only
 *    em staging.ingestion_runs, tabela com SELECT para o service_role pela
 *    migração 0019). Chave de outro projecto → 401 "Invalid API key". Não
 *    escreve nada. public.sources NÃO é lido: o service_role não tem
 *    privilégios nessa tabela por desenho (menor privilégio).
 * 3. Mostra o estado FiSH/UK no staging (contagens).
 */
import { assertEnvironment } from '../src/lib/envGuard';
import { getSupabaseClient } from '../src/persistence/client/supabase';
import { FISH_CONFIG } from '../src/collectors/fish-ics/config';

async function main(): Promise<void> {
  const g = assertEnvironment();
  console.log(`envGuard: ACEITE — ambiente=${g.environment} project_ref=${g.projectRef}`);
  console.log(`chave: formato=${g.serviceKeyFormat} associacao_no_envGuard=${g.serviceKeyProjectBinding}`);
  for (const w of g.warnings) console.log(`aviso: ${w}`);

  const db = getSupabaseClient();
  const src = await db.schema('staging').from('ingestion_runs').select('id', { count: 'exact', head: true });
  if (src.error) {
    console.log(`leitura ao staging: FALHOU (${src.error.code ?? ''} ${src.error.message}) — associação chave↔projecto NÃO confirmada`);
    process.exit(1);
  }
  console.log(`leitura ao staging: OK (staging.ingestion_runs=${src.count}) — a chave é aceite pelo projecto ${g.projectRef}`);

  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const r = await q; if (r.error) throw new Error(r.error.message); return r.count;
  };
  const fishRaw = await count(db.schema('staging').from('raw_activity_items').select('id', { count: 'exact', head: true }).eq('source_key', FISH_CONFIG.source_key));
  const fishRuns = await count(db.schema('staging').from('ingestion_runs').select('id', { count: 'exact', head: true }).eq('source_key', FISH_CONFIG.source_key));
  const uk = await count(db.schema('staging').from('activities_staging').select('id', { count: 'exact', head: true }).eq('product_key', FISH_CONFIG.product_key));
  console.log(`estado: raw_fish=${fishRaw} runs_fish=${fishRuns} actividades_uk=${uk}`);
}

main().catch(e => { console.error(`envGuard/leitura RECUSA: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
