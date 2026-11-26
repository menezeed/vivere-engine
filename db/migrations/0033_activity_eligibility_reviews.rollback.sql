-- Rollback da 0033 — remove a tabela de revisões humanas de elegibilidade.
-- ATENÇÃO: apaga a trilha de auditoria das revisões 60+. Exportar antes:
--   select * from staging.activity_eligibility_reviews order by reviewed_at;
-- Só staging. Não afecta activities_staging nem qualquer outra tabela.
drop table if exists staging.activity_eligibility_reviews;
