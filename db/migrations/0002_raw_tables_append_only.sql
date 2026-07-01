-- ============================================================
-- 0002 — Trava append-only para staging.raw_venue_items e
-- staging.raw_activity_items
--
-- Contexto: a migration 0001 já modela a Camada A (dado bruto)
-- sem coluna updated_at, sinalizando por design que essas tabelas
-- nunca deveriam ser editadas após o INSERT. Esta migration fecha
-- a lacuna identificada na revisão de segurança: ausência de
-- coluna de edição é intenção, não garantia — nada no banco
-- impedia, até agora, um UPDATE ou DELETE real.
--
-- Mecanismo escolhido: Row-Level Security (RLS) com policies que
-- bloqueiam explicitamente UPDATE e DELETE para qualquer role,
-- preferido a REVOKE porque não depende de conhecer o nome exato
-- da role de conexão da aplicação (que varia por ambiente
-- Supabase) — a trava fica visível e auditável diretamente no
-- catálogo de policies do Postgres, não escondida em GRANTs.
--
-- INSERT e SELECT recebem policies explicitamente permissivas
-- (with check (true) / using (true)) — mais seguro e auditável do
-- que depender do comportamento implícito do Postgres quando RLS
-- está ativo sem nenhuma policy cobrindo esses comandos. Apenas
-- UPDATE e DELETE são explicitamente negados.
-- ============================================================

alter table staging.raw_venue_items enable row level security;
alter table staging.raw_activity_items enable row level security;

-- Policies explícitas de INSERT e SELECT, permissivas — escolhido
-- deliberadamente em vez de depender do comportamento implícito de
-- "RLS ativo sem nenhuma policy cobrindo o comando", que pode
-- variar conforme a configuração de FORCE ROW LEVEL SECURITY do
-- ambiente. Explícito aqui é mais seguro que implícito.

create policy raw_venue_items_allow_insert
  on staging.raw_venue_items
  for insert
  with check (true);

create policy raw_venue_items_allow_select
  on staging.raw_venue_items
  for select
  using (true);

create policy raw_activity_items_allow_insert
  on staging.raw_activity_items
  for insert
  with check (true);

create policy raw_activity_items_allow_select
  on staging.raw_activity_items
  for select
  using (true);

-- Nenhuma policy de UPDATE/DELETE é criada com USING/WITH CHECK
-- permissivo — em vez disso, cada policy usa `using (false)`,
-- que nega a operação para QUALQUER role, sem exceção, incluindo
-- o dono da tabela (RLS se aplica ao dono também, a menos que a
-- tabela tenha FORCE ROW LEVEL SECURITY desabilitado, que não é
-- o caso aqui).

create policy raw_venue_items_no_update
  on staging.raw_venue_items
  for update
  using (false);

create policy raw_venue_items_no_delete
  on staging.raw_venue_items
  for delete
  using (false);

create policy raw_activity_items_no_update
  on staging.raw_activity_items
  for update
  using (false);

create policy raw_activity_items_no_delete
  on staging.raw_activity_items
  for delete
  using (false);

comment on policy raw_venue_items_no_update on staging.raw_venue_items is
  'Bloqueia UPDATE incondicionalmente — dado bruto da Camada A é append-only por princípio arquitetural (ver ARCHITECTURE_EVOLUTION.md). Reverter esta policy exige decisão explícita, não deveria acontecer por engano.';

comment on policy raw_activity_items_no_update on staging.raw_activity_items is
  'Bloqueia UPDATE incondicionalmente — dado bruto da Camada A é append-only por princípio arquitetural (ver ARCHITECTURE_EVOLUTION.md). Reverter esta policy exige decisão explícita, não deveria acontecer por engano.';
