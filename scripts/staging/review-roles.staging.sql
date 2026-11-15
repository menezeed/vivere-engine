-- ============================================================================
-- Papéis da Review API (SEC-A) nas contas de revisão — SÓ STAGING
-- ============================================================================
-- Porquê: a 15/11/2026 o E8 no staging deu 3 contas, todas "(sem papel)".
-- Com SEC-A, uma conta sem app_metadata.role recebe 403 em toda a Review API,
-- por isso ninguém consegue rever nem publicar.
--
-- Quem corre: o PO (mudança de acesso), no SQL Editor do projecto STAGING,
-- depois de confirmar o ref no URL. Os e-mails são preenchidos LOCALMENTE e
-- nunca são colados no GitHub; a saída só tem contagens.
--
-- Uso:
--   1. Em `alvos`, substituir os e-mails de exemplo pelas contas de revisão e
--      o papel de cada uma: viewer (só lê), reviewer (aprova/rejeita),
--      admin (também promove). Recomendação: 1 admin (o PO) e 1 reviewer.
--   2. v_confirm := 'staging'.
--   3. Correr com v_aplicar := false: mostra as contagens e desfaz tudo.
--   4. Conferir; mudar para v_aplicar := true e correr outra vez.
--   5. Repetir o E8 (SEC-AB-checklist-deploy.md §4): as contagens por papel
--      têm de bater com o que foi pedido.
--
-- Reverter: correr de novo com v_reverter := true (remove só a chave "role"
-- das contas listadas; o resto de app_metadata fica intacto).
--
-- Recusa se: ambiente não confirmado; papel inválido; e-mail não encontrado
-- (contagem diferente do número de linhas em `alvos`).
-- ============================================================================
do $papeis$
declare
  v_confirm  text    := '__AMBIENTE__';
  v_aplicar  boolean := false;
  v_reverter boolean := false;
  n_alvos int; n_encontradas int; n_alteradas int; v_resumo text;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;

  create temp table _alvos on commit drop as
  select lower(trim(e)) as email, r as papel from (values
    ('revisor-admin@example.invalid',    'admin'),
    ('revisor@example.invalid',          'reviewer')
  ) v(e, r);

  -- Revisão r0: papel NULL passava pelo NOT IN; e-mail repetido tornava o
  -- papel indeterminado no UPDATE … FROM.
  if exists (select 1 from _alvos where papel is null or papel not in ('viewer', 'reviewer', 'admin')) then
    raise exception 'RECUSA: papel inválido ou vazio (só viewer, reviewer, admin)';
  end if;
  if exists (select 1 from _alvos where email is null or email = '') then
    raise exception 'RECUSA: e-mail vazio na lista de alvos';
  end if;
  if (select count(*) from _alvos) <> (select count(distinct email) from _alvos) then
    raise exception 'RECUSA: e-mail repetido na lista de alvos (um papel por conta)';
  end if;

  select count(*) into n_alvos from _alvos;
  select count(*) into n_encontradas
    from auth.users u join _alvos a on lower(u.email) = a.email;
  if n_encontradas <> n_alvos then
    raise exception 'RECUSA: % contas pedidas, % encontradas (confirmar os e-mails localmente)', n_alvos, n_encontradas;
  end if;

  if v_reverter then
    update auth.users u
       set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'role'
      from _alvos a where lower(u.email) = a.email;
  else
    update auth.users u
       set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', a.papel)
      from _alvos a where lower(u.email) = a.email;
  end if;
  get diagnostics n_alteradas = row_count;

  -- Só papéis da allowlist aparecem pelo nome; qualquer outro valor existente
  -- fica agrupado sem ser impresso (pode conter texto arbitrário).
  select string_agg(papel || '=' || n, ', ' order by papel) into v_resumo from (
    select case
             when u.raw_app_meta_data ->> 'role' is null then '(sem papel)'
             when u.raw_app_meta_data ->> 'role' in ('viewer', 'reviewer', 'admin') then u.raw_app_meta_data ->> 'role'
             else '(outro valor)'
           end as papel, count(*) as n
    from auth.users u group by 1) t;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): % contas alteradas; ficaria: % — para aplicar, v_aplicar := true', n_alteradas, v_resumo;
  end if;
  raise notice 'APLICADO: % contas alteradas; agora: %', n_alteradas, v_resumo;
end
$papeis$;
