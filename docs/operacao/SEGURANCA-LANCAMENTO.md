# Segurança do engine para o lançamento público: estado, bloqueios e pós-lançamento (actualizado a 23/11/2026)

**Produção:** `ccpqngyupukdefaqvzgl`.

**Contexto:** a W0/W1 foi aplicada e aceite a 21/11. O pedido de Production access do Vivere 60+ (`com.vivere.app60plus`) foi enviado à Google Play a 22/11/2026, às 14:08.

**Como foi obtido este estado:**
- Fontes: auditoria só de leitura de 22/11 (Issue #46), ficheiros de evidência locais do PO e o catálogo do staging pelo MCP só de leitura.
- 23/11: P0-6 fechado com o backup v5 pós-W0/W1. Evidência: `v5-verificar-p06.ps1` 18/18 PASS e confirmação final do PO (#46, comentários 7088537713 e 7101539401).
- Este documento não altera nada na produção.

**Notação:**
- **PASS** = com prova;
- **BLOCKED** = falta acção ou decisão;
- **UNKNOWN** = sem prova disponível.

## 1. Bloqueios reais antes do lançamento público
| # | Bloqueio | Porquê é real | Fecho (sem alterar a produção) | Dono |
|---|---|---|---|---|
| B1 | **FECHADO / PASS (23/11):** backup verificado do estado pós-W0/W1 da produção | Antes só existia o A1 (manifesto `bbe7af19…3e795`, 21/11 12:09), anterior à W0/W1 | Execução `execucao-20261123-002306`, início do dump 2026-11-23 00:24:14Z. SHA-256 do manifesto `03f0971c…59e6d3`, 13 ficheiros conferidos. Restauro local descartável: auditoria 539 = 539, deriva real 0, `VEREDICTO: ACEITE`, limpeza confirmada. Estado pós-W0/W1 confirmado no dump: o `anon` não tem INSERT de tabela em `suggestions` nem UPDATE de tabela em `activities`. **Validade:** a regra ≤ 24 h exige um backup novo antes de cada mudança futura na produção | PO executou; Claude validou |
| B2 | **FECHADO / PASS (23/11):** cópia cifrada fora do PC, separada da chave | Antes, o backup e a chave existiam só num PC e numa pen | `execucao-20261123-002306.tar.gpg` na pasta OneDrive `Vivere\backup-cifrado`. SHA-256 `f8aa22e5…a3f3` confere com o `.sha256`. Cifrada só para a subchave do backup e fora da pen F:. **A sincronização remota foi confirmada pelo PO (23/11).** A chave privada está na pen e no cofre, nunca junto da cópia | PO |
| B3 | **FECHADO por decisão do PO (22/11):** a produção fica no plano **FREE**, sem backups geridos nem PITR. O upgrade não é condição de lançamento | O backup manual v5 é o único controlo. RPO = intervalo entre cópias | Cadência obrigatória: antes de cada mudança na produção; semanal no 1.º mês; quinzenal depois. Responsável: PO executa, Claude valida. Os riscos residuais F1–F7 **continuam em vigor** (§4.1) | PO |
| B4 | **P0-4: chaves Google** | Confirmado em leitura pública a 24/11: o `index.html` do admin no GitHub Pages contém **1 chave distinta** `AIza…` (impressão SHA-256 `c0938e31`, sem o valor), usada no browser para a Places API (New): `places:autocomplete` e `places/{id}`. Se não tiver restrição de referrer/API, há risco de custo. A chave Maps de produção tem de estar restrita ao package + SHA-1 do Play App Signing | Google Cloud Console: restrições e evidência na Android #30 | PO |

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
| (A) Backup da produção, **pós-W0/W1** | **PASS (23/11)** | `C:\VivereBackup\execucao-20261123-002306`. Início do dump: 2026-11-23 00:24:14Z. SHA-256 do `manifesto.txt` = `03f0971c9919173cfb29e1e596f40d494cdca8299eb2202bcb8774a99e59e6d3`; 13 ficheiros conferidos. Dumps cifrados com OpenPGP (`Vivere Backup v5`) |
| (B) Restauro num destino descartável | **PASS com limitações (23/11)** | Auditoria produção = restauro, 539 = 539, deriva real 0. Contagens exactas: 22. Verificações de integridade: 29. Objectos de auth/storage: 39. → `VEREDICTO: ACEITE`. Limpeza confirmada: servidor parado, porta fechada |
| Cópia cifrada fora do PC | **PASS (23/11)** | `execucao-20261123-002306.tar.gpg` no OneDrive. SHA-256 `f8aa22e58a522b038328890f7bf1dfb43c02693e4a716fff64758d477279a3f3`, igual ao do `.sha256`. Sincronização remota confirmada pelo PO |
| Veredicto `v5-verificar-p06.ps1` | **`P0-6: PASS`, 18/18** | #46, comentários 7088537713 e 7101539401 |
| Backup anterior A1 (21/11) | substituído, **mantido** (nada foi apagado) | `execucao-20261121-120937`, manifesto `bbe7af19…3e795`, pré-W0/W1, 536 = 536 ACEITE |
| Limitações declaradas | — | `restauro-limitacoes.txt`:<br>• `supabase_vault` omitido (0 segredos);<br>• `supabase_realtime` e as default ACL do `supabase_admin` recriadas a partir da fonte;<br>• o restauro é PostgreSQL local, não um projecto Supabase: GoTrue, API e Storage não foram testados |
| (C) Rollback | **PARCIAL** (não bloqueia, R2) | 0026: PASS no staging (A6). As restantes só na simulação local (`APPLIED.sha256`: "não executado"). 0032: rollback testado localmente (T5). Num incidente, o caminho é o backup B1 |
| Gate P0-6 | **FECHADO / PASS** (B1, B2 e B3 fechados) | Os riscos residuais estão em §4.1 |
| Critério original do P0-6 (vivere-60plus #5 e #25, de 13 a 16/11) | **substituído** | O critério dizia "PITR ou dump; restauro num projecto descartável; rollback de cada migração no staging". Pela decisão do PO de 22/11 passou a ser: dump manual v5 + restauro local ACEITE + cópia externa. O restauro num projecto Supabase ficou como risco F3 e o rollback no staging como R2/A7; nenhum dos dois bloqueia. A linha 10 da #25 ("falta o restauro de dados") e o "em aberto" da #5 estão desactualizados |

### 4.1 Riscos residuais do plano FREE (aceites pelo PO a 22/11; continuam em vigor)
| # | Risco | Mitigação |
|---|---|---|
| F1 | Sem backups geridos nem PITR | Backup v5 obrigatório ≤ 24 h antes de cada mudança na produção |
| F2 | RPO = intervalo entre cópias: até 7 dias no 1.º mês e até 14 dias depois. **A idade do dump de 23/11 cresce a partir de agora** | Cadência: semanal nas 4 semanas depois do lançamento, quinzenal depois. Retenção: as últimas 4 locais, todas as externas do 1.º mês, depois 1 por mês |
| F3 | Recuperação real num projecto Supabase nunca ensaiada; RTO desconhecido | Procedimento descrito; restaurar no mesmo projecto |
| F4 | Configuração da plataforma fora do dump: providers Auth/Google, redirects, SMTP, chaves, JWT secret | Restaurar no mesmo projecto; registar a configuração no cofre (nunca no GitHub) |
| F5 | Projectos FREE são pausados depois de cerca de 1 semana sem actividade | O tráfego real evita a pausa; o PO vigia o e-mail da Supabase |
| F6 | Um único operador (password + pen) | 2.ª cópia da chave no cofre |
| F7 | Texto em claro no disco durante o restauro (minutos) | Área cifrada com EFS e limpeza confirmada em cada execução |

## 5. Ordem mínima
1. ~~**B3:**~~ fechado (FREE, decisão do PO, 22/11). Passa a valer a cadência do backup manual.
2. ~~**B1 + B2:**~~ fechados (23/11, P0-6 18/18 PASS, sincronização remota confirmada).
3. **B4:** P0-4 na Google Cloud Console. É o **único bloqueio real de segurança que resta**. Estado (Android #30): o positivo Maps/Places na v13 passou; faltam a evidência das restrições, sem valores, da chave `AIza…` do admin Pages (referrer + API) e da chave Maps de produção (package + SHA-1 do Play App Signing).
4. Abrir ao público. Se houver uma mudança na produção antes da abertura, fazer antes um backup v5 novo (regra ≤ 24 h).
5. **R1:** a 0032 com REF Level 2, numa janela de manutenção, já com o B1 feito.
6. **R2–R4:** com autorizações próprias. Depois, a secção 3.
