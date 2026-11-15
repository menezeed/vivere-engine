-- ============================================================
-- Fixtures SÓ LOCAIS para lote2-http-e2e.local.mjs (REF: Lote 2).
-- Recusa correr fora da simulação local (vivere.sim = 'local').
-- Correr como superutilizador local numa base descartável com
-- supabase-sim.sql + 0000..0025. Os dados FICAM (o PostgREST precisa de
-- os ver); usar só numa base de teste que depois é apagada.
-- ============================================================
do $fx$
begin
  if coalesce(current_setting('vivere.sim', true), '') <> 'local' then
    raise exception 'Recusado: script só para a simulação local (vivere.sim).';
  end if;

  insert into auth.users(id, email, raw_app_meta_data, email_confirmed_at) values
    ('00000000-0000-4000-8000-0000000003a1', 'a.http@example.invalid', '{"provider":"email"}', now()),
    ('00000000-0000-4000-8000-0000000003b1', 'b.http@example.invalid', '{"provider":"email"}', now()),
    ('00000000-0000-4000-8000-0000000003c1', 'm.http@example.invalid', '{"provider":"email","role":"reviewer"}', now()),
    ('00000000-0000-4000-8000-0000000003d1', 'd.http@example.invalid', '{"provider":"email"}', now());
  -- sessões: created_at relativo ao relógio do servidor; as frescas valem 5 min
  insert into auth.sessions(id, user_id, created_at, updated_at, refreshed_at, not_after) values
    ('10000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003a1', now(), now(), null, null),
    ('10000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003c1', now(), now(), null, null),
    ('10000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003d1', now(), now(), null, null),
    ('10000000-0000-4000-8000-0000000003d2', '00000000-0000-4000-8000-0000000003d1',
      now() - interval '10 minutes', now(), now()::timestamp, null);
  insert into public.activities(id, title, start_date, recurrence_type, interested_count) values
    ('20000000-0000-4000-8000-0000000003a1', 'Lote2 HTTP activa', now() + interval '7 days', 'none', 10);
  insert into public.activities(id, title, start_date, end_date, recurrence_type, interested_count) values
    ('20000000-0000-4000-8000-0000000003a2', 'Lote2 HTTP inactiva', now() - interval '30 days', now() - interval '20 days', 'none', 0);
  insert into public.favorites(user_id, activity_id) values
    ('00000000-0000-4000-8000-0000000003d1', '20000000-0000-4000-8000-0000000003a1');
  insert into public.suggestions(title, phone, email, comment) values
    ('Lote2 HTTP sugestao D', '+351900000009', 'd.http@example.invalid', 'comentario');
end;
$fx$;
