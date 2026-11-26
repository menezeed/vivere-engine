-- ============================================================
-- FIXTURE SÓ LOCAL: reproduz, sobre a cadeia 0000→0022 da simulação, o ACL
-- da PRODUÇÃO observado no pré-voo da E2 (20/11/2026; 0023 P2 = 11,
-- MATRIZ = 0, 0024 P2 = 20, EXCESSO = 4). NUNCA correr num Supabase.
-- Correr como postgres (grantor = postgres, como na produção).
-- A fidelidade é verificada pelo runner: o pré-voo sobre esta base tem de
-- devolver EXACTAMENTE as linhas 0024 P2 e EXCESSO da produção.
-- ============================================================
do $g$ begin
  if coalesce(current_setting('vivere.sim', true), '') <> 'local' then
    raise exception 'Recusado: fixture so para a simulacao local (vivere.sim)';
  end if;
end $g$;

-- 5 tabelas da 0023: matriz da app + os excessos observados
grant select on public.categories, public.venues, public.partners to anon, authenticated;
grant select, insert, update, delete on public.favorites to authenticated;
grant insert on public.suggestions to anon, authenticated;

-- activity_interests como na produção (a app instalada escreve directamente)
revoke truncate, references, trigger, maintain on public.activity_interests from anon, authenticated;
grant select, insert on public.activity_interests to anon;
grant select, insert, delete on public.activity_interests to authenticated;

-- active_activities: MAINTAIN (PG17) além dos 7 da 0000
grant maintain on public.active_activities to anon, authenticated;
