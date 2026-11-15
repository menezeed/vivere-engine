-- Rollback 0029 — repõe o filtro do baseline 0000 (CURRENT_DATE, data UTC).
-- Mesmas colunas, security_invoker e ACL (CREATE OR REPLACE VIEW preserva-os).
create or replace view public.active_activities
with (security_invoker = true)
as
select id, title, description, category, venue_id, schedule, price,
  is_free, imagem_url, is_sponsored, created_at, start_date, end_date,
  recurrence_type, recurrence_days, recurrence_time, phone, url,
  interested_count
from public.activities
where (end_date is null or end_date >= current_date)
  and (recurrence_type is not null and recurrence_type <> 'none'
       or recurrence_type = 'none' and start_date >= current_date);

comment on view public.active_activities is null;
