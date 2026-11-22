# Segurança do engine para o lançamento público: estado, bloqueios e pós-lançamento (22/11/2026)

**Produção:** `ccpqngyupukdefaqvzgl`.

**Contexto:** a W0/W1 foi aplicada e aceite a 21/11. O pedido de Production access do Vivere 60+ (`com.vivere.app60plus`) foi enviado à Google Play a 22/11/2026, às 14:08.

**Como foi obtido este estado:**
- Fontes: auditoria só de leitura de 22/11 (Issue #46), ficheiros de evidência locais do PO e o catálogo do staging pelo MCP só de leitura.
- Este documento não altera nada na produção.

**Notação:**
- **PASS** = com prova;
- **BLOCKED** = falta acção ou decisão;
- **UNKNOWN** = sem prova disponível.

## 1. Bloqueios reais antes do lançamento público
| # | Bloqueio | Porquê é real | Fecho (sem alterar a produção) | Dono |
|---|---|---|---|---|
| B1 | **Não existe backup verificado do estado actual da produção** | O único backup verificado (A1, manifesto `bbe7af19…3e795`, 21/11 12:09) foi tirado **antes** da W0/W1. Restaurá-lo hoje perdia a W0/W1 e qualquer dado criado depois. Com utilizadores públicos, uma perda de dados deixa de ser recuperável | Backup v5 (`v5-backup.ps1 -Alvo producao`: o pg_dump só lê) + restauro local `ACEITE`, nas 24 h antes da abertura ao público | PO (pen F: e passphrase) |
| B2 | **O backup e a chave existem só num PC e numa pen** | Uma avaria ou perda do PC elimina o único backup | Cópia **cifrada** da pasta de execução para um local fora do PC; a chave privada fica separada do backup | PO |
| B3 | **FECHADO por decisão do PO (22/11):** a produção fica no plano **FREE**, sem backups geridos nem PITR. O upgrade não é condição de lançamento | O backup manual v5 é o único controlo. RPO = intervalo entre cópias | Cadência obrigatória: antes de cada mudança na produção; semanal no 1.º mês; quinzenal depois. Responsável: PO executa, Claude valida. Riscos F1–F7 no roteiro P0-6 (fora do repositório) | PO |
| B4 | **P0-4: chaves Google** | O admin público (GitHub Pages) tem uma chave `AIza…`. Se não tiver restrição de referrer/API, há risco de custo. A chave Maps de produção tem de estar restrita ao package + SHA-1 do Play App Signing | Google Cloud Console: restrições e evidência na Android #30 | PO |

## 2. Não bloqueia o lançamento: recomendado antes, ou logo a seguir
| # | Item | Estado | Porque não bloqueia | Quando |
|---|---|---|---|---|
| R1 | **0032: privilégio mínimo** em `categories`/`venues`/`partners`/`favorites` (PR #49) | Preparada; CI verde; simulação local 59/59; **não aplicada** | Prova na auditoria da produção (A1, `prod-auditoria.csv`), secção A/D: o **RLS está activo** nas 4 tabelas. Políticas: escrita no catálogo só com `app_metadata.role = admin`; leitura pública; favorites `ALL` com `auth.uid() = user_id`. O PostgREST não expõe TRUNCATE, e as escritas pela API são filtradas pelo RLS. O excesso de privilégios só seria explorável com login SQL directo como `anon`/`authenticated`, ou por uma função `SECURITY INVOKER` com SQL dinâmico; nenhum dos dois foi identificado. Resíduo: um utilizador autenticado pode fazer UPDATE nos **seus** favoritos (impacto baixo) | 1.ª janela de manutenção, com REF Level 2, **depois do B1** |
| R2 | **A7:** rollbacks 0025 → 0024 → 0030 (e 0031, 0029) ensaiados no staging | BLOCKED (não autorizado). Ensaiados só na simulação local; a 0026 foi ensaiada no staging (A6, PASS) | A W1 está aceite e não há rollback previsto. Um incidente usa o B1 | Antes de qualquer rollback planeado |
| R3 | **SEC-O / P0-5:** `anon` legada, `service_role` legada, chave do admin Pages, JWT secret | Decisão do PO: a `anon` legada mantém-se até à W3; o resto está pendente, sem autorização | A `anon` é pública por natureza e está limitada pelo RLS. A `service_role` legada não tem consumidor de produção conhecido | `service_role`: desactivar (reversível) com autorização própria. W3: `anon` + JWT secret |
| R4 | **Esquema `staging` na produção:** `anon`/`authenticated` com USAGE (ATENCAO pré-existente) | Por medir: falta a consulta só de leitura ao ACL das tabelas | Pode estar coberto pelo ACL das tabelas; não há prova de exposição | Consulta só de leitura, depois uma 0033 exacta |

## 3. Pós-lançamento: backlog do engine (sem efeito na app publicada)
| Item | Estado | Prova |
|---|---|---|
| SEC-A (papel explícito na Review API) | PASS no código (`main`, PR #7). Em uso está BLOCKED: no staging, 3 contas sem papel (E8 em falta) | consulta ao staging, 22/11 |
| SEC-B (JWT ES256/RS256 via JWKS) | Só em `integracao/migrations-p0`; entra em `main` com o PR #19 | `src/review-api/middleware/jwtVerifier.ts` |
| SEC-O, guard de ambiente | PASS: `PRODUCTION_BLOCKED` em todos os clientes do engine | `src/lib/envGuard.ts` |
| Review API / Admin Panel do engine | Não está alojada; ferramenta só para o staging (PR #48) | `REVIEW-API-PRONTIDAO.md` |
| L5, orçamento persistente (0028) | PR #18 aberto; 0028 ausente no staging; o tecto em memória está em `main` | consulta ao staging, 22/11 |
| Ingestão real | Só no staging: 2 runs `success` (15/11), 1 actividade publicada | `staging.ingestion_runs` |
| Admin Pages: lista de utilizadores vazia (`public.users` sem SELECT para `authenticated`) | pré-existente, funcional | auditoria A1 |

## 4. Evidência de backup, restauro e rollback (P0-6)
| Componente | Estado | Evidência |
|---|---|---|
| (A) Backup da produção | **PASS** (estado pré-W0/W1) | `C:\VivereBackup\execucao-20261121-120937`. SHA-256 do `manifesto.txt` = `bbe7af190b8a527b899caac9ff00c272c03ce46e3515622c37a6f25cd8b3e795` (recalculado a 22/11). Dumps cifrados com OpenPGP (`Vivere Backup v5`) |
| (B) Restauro num destino descartável | **PASS com limitações** | `restauro-resultado.txt`: auditoria 536 = 536, deriva 0; contagens 22/22; integridade 29; auth/storage 39 → `VEREDICTO: ACEITE`. Limpeza confirmada (`restauro-limpeza.txt`) |
| Limitações declaradas | — | `restauro-limitacoes.txt`:<br>• `supabase_vault` omitido (0 segredos);<br>• `supabase_realtime` e as default ACL do `supabase_admin` recriadas a partir da fonte;<br>• o restauro é PostgreSQL local, não um projecto Supabase: GoTrue, API e Storage não foram testados |
| (C) Rollback | **PARCIAL** | 0026: PASS no staging (A6). As restantes só na simulação local (`APPLIED.sha256`: "não executado"). 0032: rollback testado localmente (T5) |
| Gate do lançamento | **BLOCKED → B1, B2, B3** | — |

## 5. Ordem mínima
1. **B3:** fechado (FREE, decisão do PO). Passa a valer a cadência do backup manual.
2. **B4:** P0-4 na Google Cloud Console.
3. **B1 + B2:** backup v5 novo, restauro `ACEITE` e cópia cifrada fora do PC. O Claude lê as evidências e fecha o P0-6 (A/B).
4. Abrir ao público.
5. **R1:** a 0032 com REF Level 2, numa janela de manutenção, já com o B1 feito.
6. **R2–R4:** com autorizações próprias. Depois, a secção 3.
