-- ============================================================
-- Rollback 0024 — BLOQUEADO (SEC-O-016B)
--
-- A 0024 não concede nada enquanto estiver bloqueada, por isso não há
-- nada a reverter. Este ficheiro só levanta uma excepção. Será escrito
-- com a mesma estrutura do rollback da 0023 (verificar ACL e grantor,
-- retirar só o que a 0024 concedeu) quando a 0024 for desbloqueada.
-- ============================================================

do $$
begin
  raise exception 'Rollback 0024 BLOQUEADO (SEC-O-016B): a 0024 nao concede nada.';
end;
$$;
