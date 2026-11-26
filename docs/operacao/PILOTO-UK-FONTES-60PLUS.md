# Piloto Richmond UK: fontes novas de actividades 60+ (viabilidade e preview)

**Data:** 26/11/2026. **Produto:** `vivere-60-plus-uk-test`, só staging.

**Estado:** preview/dry-run. **Nada foi gravado** em base de dados: sem ingestion_run, sem raw items e sem staging. A integração FiSH em staging está preparada (§7) e espera autorização.

**Não houve:**
- nova recolha da u3a;
- aprovação das 133 actividades existentes;
- publicação, merge ou alteração de produção.

## 1. Matriz de viabilidade

| # | Fonte | Plataforma | Fonte estruturada | Restrições (robots / termos) | Evidência 60+ | Actividades novas (estimativa) | Viabilidade | Decisão proposta |
|---|---|---|---|---|---|---|---|---|
| 1 | **Age UK Richmond upon Thames** | Episerver (alojado em ageuk.org.uk) | **Não**: HTML; RSS dá 404; sem iCal nem JSON-LD visível. Os horários regulares estão em **imagens PNG** | robots: `/richmonduponthames/` permitido. **Termos, cl. 5:** proíbem "reproduction, storage, modification, distribution" sem consentimento escrito prévio; cl. 8 exige licença | Forte em parte: "over 60 years" (Community Connections), "65 +" (Connect to Tech), "Anyone over 60" (Walking Football). A organização é dirigida a pessoas mais velhas | ~17 itens (8 com data, ~9 recorrentes), mais os horários em imagem por quantificar | **Técnica: média-baixa** (datas sem ano, imagens, páginas desactualizadas). **Legal: bloqueada** | **Pedir consentimento escrito** à Age UK Richmond antes de qualquer colector. Sem colector até lá |
| 2 | **FiSH Neighbourhood Care** | WordPress + The Events Calendar | **Sim**: ICS público `https://www.fishhelp.org.uk/events/list/?ical=1` (TZID Europe/London, uma VEVENT por ocorrência) | robots: proíbe `/wp-json/`, `/?rest_route=`, `/*post_type=tribe_events`, a paginação de `/events/` e PDFs; Crawl-delay 10. O URL do ICS **não** coincide com nenhum Disallow. Termos de reutilização não encontrados | Ao nível da organização: "for the older community of Barnes, Mortlake and East Sheen". **Nenhuma actividade** refere idade no ICS | **13 séries / 30 ocorrências** (janela de 26/11 a 16/12) | **Alta** | **Implementado (preview)**. Gravar em staging só com autorização |
| 3 | **Richmond Council / Full of Life** | Umbraco (richmond.gov.uk) | **Não**: é uma **feira anual de um dia** (30/10/2026, Twickenham Stadium, já passou). O programa é um PDF | robots: só `/search_results` proibido. Licença OGL não confirmada | Público-alvo "older residents, as well as carers" (a feira) | 0 actividades contínuas | **Baixa** como fonte de actividades | Usar o PDF do programa só para **descobrir organizações** (curadoria), não como feed |
| 4 | **Ruils Independent Living** | WordPress (Yoast, Gravity Forms) | **Não**: `/wp-json/` dá 401; o RSS só tem notícias | robots: Crawl-delay 10; proíbe `/wp-admin/` e WooCommerce. Termos não lidos | Fraca: "All groups are open to anyone 18+"; 1 explícita ("Embracing Age Activities for older people", com lista num site externo); 3 "all ages/abilities" | ~13 grupos, dos quais 1 explícito e 3 inclusivos | **Média** (13 páginas HTML estáveis) mas **pouca relevância 60+** | Prioridade baixa: curadoria manual de 1 a 4 grupos, ou parser HTML depois de ler os termos |
| 5 | **Better (GLL)** | Site próprio; reservas Innovatise | **Sim**: OpenActive, **CC BY 4.0**, no catálogo oficial. `https://better-admin.org.uk/api/openactive/better/session-series` e `/scheduled-sessions` (RPDE 1.0) | robots de better.org.uk proíbe `*/timetable?*`, `*/api/innovatise/*` e `*start_date*`. O robots de better-admin.org.uk (lido a 26/11/2026, antes do spike) permite tudo. Os feeds são **nacionais** (páginas de ~3,75 MB) | Fraca: "over 50s", "older adults" misturado com outros públicos, preços "Senior/60+". Nenhuma sessão 60+ recorrente confirmada em Richmond | **Spike feito (§8):** 10 séries em Richmond, **4 activas**, 1 explícita 60+ ("Swim for 60+", `ageRange` min 60) | **Técnica: alta** (dados abertos e licenciados; feed nacional inteiro em 5 pedidos). **Relevância: baixa-média** | Colector OpenActive pequeno, só depois de autorização; validar ocorrências futuras em `scheduled-sessions` |

**Total realista hoje:** 13 séries novas (FiSH).
- **Depois da curadoria FiSH (§7):** 11 a inserir (1 serviço fora; 2 palestras juntas numa série).
- **Com consentimento da Age UK e curadoria:** até ~35–40 itens (FiSH 11, Age UK ~17, Ruils 1–4, Better 4).
- A maior parte das novas ficaria em `likely_suitable`, e não "confirmado".

## 2. FiSH: preview real (dry-run)

**Como foi feito:**
- `npx tsx scripts/preview-fish.ts --report=<ficheiro>`, com **um pedido HTTP** por execução (foram 2 execuções, com bem mais de 10 s entre elas).
- 30 VEVENT lidos → **13 séries**, 30 ocorrências futuras. Nenhuma exclusão (nada passado, cancelado, online ou privado na janela).
- **Elegibilidade proposta** (mesmas classes e formato da Issue #62, sempre com nota de revisão humana):

  | Classe | Séries |
  |---|---|
  | `likely_suitable` | 12 |
  | `unclear` | 1 (Shopping Bus: serviço, não lazer) |
  | `confirmed_60plus` | **0** (nenhuma actividade refere idade) |

- **Duplicados com a u3a:** 0 (comparação com as 133 do dataset auditado; a u3a não foi recolhida de novo).
- **Privacidade:** o relatório tem 0 e-mails e 0 telefones. A descrição livre não é copiada.

| Actividade | Datas (2026) | Horário | Recorrência | Local | Custo | Inscrição | Disponibilidade | Proposta | Público (fonte) |
|---|---|---|---|---|---|---|---|---|---|
| Board Games | 11-30, 12-07, 12-14 | 16:30–17:30 | semanal (observado) | não indicado no ICS | não indicado | reserva obrigatória | vagas limitadas | `likely_suitable` | — |
| Coffee Corner | 12-02, 12-09, 12-16 | 10:30–12:00 | semanal (observado) | The Sheen Lane Centre, SW14 8LP | não indicado | sem reserva | aberto (sem reserva) | `likely_suitable` | — |
| FiSH Bridge | 12-02, 12-16 | 14:00–16:45 | quinzenal (observado) | não indicado no ICS | não indicado | não indicada | não confirmada | `likely_suitable` | "…not a group for beginners." |
| Good Afternoon Choir | 11-26, 12-03, 12-10 | 15:00–16:15 | semanal (observado) | The Barnes Green Centre, SW13 9HE | não indicado | não indicada | não confirmada | `likely_suitable` | — |
| MeetUpMondays™ | 11-30, 12-07, 12-14 | 11:00–13:00 | semanal (observado) | Hare & Hounds, SW14 8AH (pub) | não indicado | não indicada | não confirmada | `likely_suitable` | "Everyone welcome!" |
| Picassos in the Park Art | 12-01, 12-08, 12-15 | 13:30–15:00 | semanal (observado) | The Barnes Green Centre, SW13 9HE | não indicado | reserva obrigatória | não confirmada | `likely_suitable` | "For people living with early stage dementia and their carers." |
| Retro Club East Sheen | 12-04 | 14:30–15:30 | ocorrência única na janela | Christ Church East Sheen, SW14 7AW | não indicado | não indicada | não confirmada | `likely_suitable` | "…people living with memory loss in East Sheen…" |
| Shopping Bus | 12-02, 12-09, 12-16 | 11:00–14:00 | semanal (observado) | não indicado no ICS | não indicado | reserva obrigatória | não confirmada | `unclear` | — |
| Singing for the Brain | 11-26, 12-03, 12-10 | 13:30 (fim não indicado) | semanal (observado) | The Barnes Green Centre, SW13 9HE | não indicado | reserva obrigatória | não confirmada | `likely_suitable` | "…people with dementia and their carers…" |
| StarFiSH | 11-27, 12-04, 12-11 | 10:30–11:45 | semanal (observado) | The Barnes Green Centre, SW13 9HE | £5.00 per session | reserva obrigatória | não confirmada | `likely_suitable` | — |
| The Reader | 12-02 | 11:00–12:30 | ocorrência única na janela | The Barnes Green Centre, SW13 9HE | não indicado | não indicada | não confirmada | `likely_suitable` | "All FiSH members welcome" |
| Tuesday Talk - Kew Ukewlele Band (grafia da fonte) | 12-08 | 11:00–12:00 | ocorrência única na janela | The Barnes Green Centre, SW13 9HE | almoço opcional £8.00 (Age UK), não é preço da palestra | não indicada | não confirmada | `likely_suitable` | — |
| Tuesday Talk (título com nome do orador, omitido) | 12-01 | 11:00–12:00 | ocorrência única na janela | The Barnes Green Centre, SW13 9HE | idem | não indicada | não confirmada | `likely_suitable` | — |

Notas comuns às 13 séries:
- **Adesão:** é preciso ser membro da FiSH, com quota de **£30/ano** (página Join us, 26/11/2026). A quota não é custo da actividade.
- **"Não indicado" não significa gratuito.**
- **A recorrência é observada nas datas** do ICS (janela de ~3 semanas). A fonte não a declara.

## 3. Implementação (branch `feat/piloto-uk-fontes-60plus`)

| Peça | Ficheiro |
|---|---|
| Parser iCalendar (desdobra linhas, TZID, VALUE=DATE, ignora VALARM, RRULE como texto) | `src/collectors/ics/icsParser.ts` |
| Colector FiSH (um GET; séries com chave estável `series:<título>:<dia>:<hhmm>`; exclusões com motivo; `description`/`contact_*` = null) | `src/collectors/fish-ics/FishIcsCollector.ts`, `config.ts` |
| Extracção por allowlist (preço com contexto, reserva, vagas, transporte, público, evidência explícita 60+; descarta orações com contacto; sinaliza título com possível nome de pessoa) | `src/collectors/fish-ics/fishText.ts` |
| Proposta de elegibilidade (classes e `EligibilityRecord` da Issue #62; confiança nunca "high"; nota de revisão humana obrigatória) e relatório de duplicados entre fontes (`normalizeVenueName` de `duplicateDetection.ts`) | `src/review-api/eligibility/proposal.ts` |
| Preview sem BD (máx. 1 pedido; `--ics-file` para offline) | `scripts/preview-fish.ts` |
| Formato de `source_item_id` no dataset auditado alargado para aceitar `series:…`. Continua a recusar espaços e maiúsculas | `src/review-api/eligibility/eligibilityAudit.ts` |

**Testes novos** (fixtures sintéticas, sem rede): parser ICS, colector (agrupamento, exclusões, local, privacidade, um único pedido, erros HTTP, URL fora dos Disallow), extracção, proposta e duplicados.

## 4. Limitações técnicas

1. **FiSH, janela curta:** o ICS cobre ~3 semanas e devolveu exactamente 30 eventos (pode haver um limite). A paginação de `/events/` é proibida pelo robots. É preciso uma execução regular, por exemplo semanal, para manter as séries.
2. **FiSH, URL por ocorrência:** cada ocorrência tem um post próprio (`…-2-2-2/`). A verificação cruzada da Issue #62 (`source_url == external_url`) **daria mismatch** de semana para semana. Antes de carregar a FiSH no dataset auditado, a verificação para fontes ICS tem de passar a ser chave da série mais o host oficial.
3. **FiSH, campos ausentes:** o local falta em 3 séries; o custo, a idade e a disponibilidade estão quase sempre ausentes; as horas do ICS divergem por vezes das da página "Activities". Tudo fica "não indicado", sem inferência.
4. **Dados pessoais:** as descrições da FiSH e da Age UK trazem nomes, e-mails e telefones. O colector nunca guarda o texto livre. Os títulos de palestras podem trazer o nome do orador (sinalizado para revisão).
5. **Age UK:** os termos proíbem armazenar e reproduzir sem consentimento escrito. Os horários regulares estão em imagens, as datas não têm ano e há páginas desactualizadas.
6. **Better:** o feed OpenActive é nacional e grande; é preciso ler o RPDE completo e filtrar Richmond. O `ageRange` existe só em alguns itens (min 16). "Senior"/"60+" aparece sobretudo como preço, não como sessão.
7. **Fuso:** as horas são guardadas em hora local de Londres. A publicação de produtos fora do BR continua bloqueada até U8.

## 5. Incidente da investigação (registo)

Na investigação da FiSH, um pedido meu ao agente de leitura web mandava testar `/wp-json/` antes de ler o robots.txt.
- **O que aconteceu:** foram feitos **3 pedidos a caminhos proibidos** pelo robots.txt (`/wp-json/`, `/wp-json/wp/v2/types` e `/wp-json/tribe/events/v1/events`, que deu 429). Houve também um 429 em `/help/`.
- **O que muda:** o colector só usa o ICS permitido, com um pedido por execução. Nas próximas investigações, o robots.txt é lido **antes** de qualquer outro pedido.

## 6. Próximos passos (cada um precisa de autorização)

1. **FiSH, gravação em staging** (preparada, §7): o PO corre o seed `scripts/staging/fonte-fish.staging.sql` e autoriza `ingest-fish.ts --apply --confirm=staging`. Depois: revisão humana das 11 propostas e, só então, um dataset auditado FiSH com verificação cruzada por série + host (limitação 2).
2. **Age UK:** rascunho do pedido de consentimento em `docs/operacao/PEDIDO-AUTORIZACAO-AGEUK-RICHMOND.md`. O PO confirma o contacto oficial e envia. Sem resposta, só curadoria manual de factos e decisão jurídica do PO.
3. **Better:** colector OpenActive com filtro por códigos postais de Richmond (4 séries activas), atribuição "Better" (CC BY 4.0) e confirmação de ocorrências futuras em `scheduled-sessions`.
4. **Ruils:** mantém-se a curadoria manual (sem colector). Ler os termos antes de qualquer pedido; candidatos: "Embracing Age" e os grupos "all ages".
5. **Council / Full of Life:** extrair do PDF do programa só a lista de organizações expositoras, para descobrir fontes novas. Não é feed de actividades.

## 7. FiSH: integração em staging preparada (sem escrita)

**Dados usados:** só o snapshot já recolhido (relatório do preview de 26/11/2026, 11:59 UTC; 1 pedido permitido ao ICS). `ingest-fish.ts` faz **0 pedidos HTTP**. Cópia durável do snapshot fora do repositório: `C:\Projects\Vivere\reviews\piloto-uk\fish-preview-2026-11-26.json`.

**Curadoria (determinística, testada em `fishSnapshot.ts`):**
- **Shopping Bus** fica fora: é um serviço de transporte, não uma actividade (decisão de âmbito do PO).
- **Tuesday Talk:** as duas palestras são a mesma série semanal (ter. 11:00, Barnes Green Centre), com tema diferente em cada sessão. Juntam-se em `series:tuesday-talk:tue:1100`, título "Tuesday Talk", **sem os temas** (um tinha o nome do orador).
- **Público restrito:** Picassos in the Park, Retro Club e Singing for the Brain são para pessoas com demência ou perda de memória e cuidadores. São actividades reais, mas não abertas ao 60+ em geral: a proposta passa a `unclear` (regra nova `RESTRICTED_AUDIENCE` em `proposal.ts`).
- Ocorrências anteriores ao dia da execução são removidas (num dia posterior a 26/11 as contagens de ocorrências descem).
- Guarda final: falha se algum campo tiver e-mail ou telefone.

**Verificação dos candidatos:**

| Série | Actividade real | Proposta 60+ | Datas (2026) | Horário | Local | Custo | Decisão |
|---|---|---|---|---|---|---|---|
| Board Games | sim | `likely_suitable` (categoria "Intergenerational") | 11-30, 12-07, 12-14 | 16:30–17:30 | não indicado | não indicado | inserir |
| Coffee Corner | sim | `likely_suitable` | 12-02, 12-09, 12-16 | 10:30–12:00 | Sheen Lane Centre, SW14 8LP | não indicado | inserir |
| FiSH Bridge | sim | `likely_suitable` ("not for beginners") | 12-02, 12-16 | 14:00–16:45 | não indicado | não indicado | inserir |
| Good Afternoon Choir | sim | `likely_suitable` | 11-26, 12-03, 12-10 | 15:00–16:15 | Barnes Green Centre, SW13 9HE | não indicado | inserir |
| MeetUpMondays™ | sim | `likely_suitable` ("Everyone welcome") | 11-30, 12-07, 12-14 | 11:00–13:00 | Hare & Hounds, SW14 8AH (pub) | não indicado | inserir |
| Picassos in the Park Art | sim | **`unclear`** (demência + cuidadores) | 12-01, 12-08, 12-15 | 13:30–15:00 | Barnes Green Centre | não indicado | inserir |
| Retro Club East Sheen | sim | **`unclear`** (perda de memória) | 12-04 | 14:30–15:30 | Christ Church East Sheen, SW14 7AW | não indicado | inserir |
| Singing for the Brain | sim | **`unclear`** (demência + cuidadores) | 11-26, 12-03, 12-10 | 13:30 (fim não indicado) | Barnes Green Centre | não indicado | inserir |
| StarFiSH | sim (dança) | `likely_suitable` | 11-27, 12-04, 12-11 | 10:30–11:45 | Barnes Green Centre | £5.00 por sessão | inserir |
| The Reader | sim | `likely_suitable` | 12-02 | 11:00–12:30 | Barnes Green Centre | não indicado | inserir |
| Tuesday Talk (2 sessões juntas) | sim | `likely_suitable` | 12-01, 12-08 | 11:00–12:00 | Barnes Green Centre | almoço opcional £8.00, não é preço da palestra | inserir |
| Shopping Bus | **não** (serviço) | `unclear` | 12-02, 12-09, 12-16 | 11:00–14:00 | não indicado | não indicado | **fora** |

Todas: adesão FiSH £30/ano (separada do custo); nenhuma com evidência explícita 60+ (`confirmed_60plus` = 0).
- **Duplicados:** 0 com as 133 da u3a.
- **Locais:** nenhum dos 5 locais FiSH existe nos 26 venues UK do staging (verificado só por leitura).

**Contagem final para autorização** (dry-run de 26/11/2026):

| Tabela | Linhas novas |
|---|---|
| `public.sources` (seed, corrido pelo PO) | 1 |
| `staging.ingestion_runs` | 1 |
| `staging.raw_activity_items` | 11 (27 ocorrências) |
| `staging.activities_staging` (`pending_review`, venue `unresolved`) | 11 |
| `staging.venues_staging` | 0 |

Propostas: `likely_suitable` 8, `unclear` 3. As 133 da u3a e os 26 venues não mudam.

**Idempotência:** antes de escrever, o script lê as séries FiSH já em `activities_staging` do produto e salta-as; se já estiverem todas, não abre `ingestion_run`. A segunda execução insere 0.

**Guardas do modo de escrita:**
- `--apply` exige `--confirm=staging`;
- o `envGuard` recusa produção;
- o script recusa se a fonte não existir;
- nunca aprova, promove nem publica.

**Comandos** (PowerShell, a partir de `C:\Projects\Vivere\wt\engine-uk`):
```powershell
# dry-run (sem BD, sem rede)
npx tsx scripts/ingest-fish.ts --snapshot=C:\Projects\Vivere\reviews\piloto-uk\fish-preview-2026-11-26.json --report=fish-dryrun.json
# escrita em staging: SÓ depois do seed e da autorização
npx tsx --env-file="<ficheiro de ambiente de staging, fora do repo>" scripts/ingest-fish.ts --snapshot=C:\Projects\Vivere\reviews\piloto-uk\fish-preview-2026-11-26.json --apply --confirm=staging --report=fish-apply.json
```

**Limitações:**
- A recorrência é só observada: os campos `recurrence_*` ficam null e as datas vão em `occurrences`.
- A janela do ICS é curta, por isso as séries envelhecem sem uma nova recolha. Uma nova recolha é outro pedido ao ICS e precisa de autorização.

## 8. Better: spike OpenActive (só leitura, limitado)

- **Ordem respeitada:** primeiro o robots.txt de better-admin.org.uk (`Disallow:` vazio, tudo permitido). A licença vem no próprio feed: CC BY 4.0.
- **Pedidos:** 1 de teste e 5 de recolha ao `session-series`, com 3 s entre pedidos. Todos deram HTTP 200, sem 429.
  - O feed nacional inteiro tem **1 619 itens** (333 apagados) e chegou ao fim em 5 páginas (~25 MB).
  - `scheduled-sessions` **não** foi lido.
- **Nada gravado:** nem em BD nem no repositório. A página bruta (com nomes de instrutores) foi apagada; ficou só um resumo.
- **Richmond** (TW1, TW2, TW9, TW10, TW11, TW12, SW13, SW14): **10 séries** em 3 locais (Teddington Pools and Fitness Centre, Pools on the Park, Better Gym Teddington). **6 têm `endDate` no passado**; as activas são:

| Série | Local | Horário | Preço | Idade | Leitura 60+ |
|---|---|---|---|---|---|
| **Swim for 60+** | Pools on the Park, TW9 2SF | seg.–sex. 09:30–10:25 | não indicado | `ageRange` min **60** | **confirmada pela fonte** |
| Aqua Aerobics | Teddington Pools, TW11 8EZ | seg. 11:30–12:15 | Adult £8.80 | 16–110 | provável (baixo impacto, de dia) |
| Swim for all | Pools on the Park | seg. 10:30–11:25 | Adult £6.90 | — | geral, todas as idades |
| Group Cycle | Teddington Pools | ter. 18:00–18:45 | Adult £11.70 | 16–110 | geral |

- **Viabilidade:** técnica alta (JSON-LD estruturado com horário, preço, idade, local e código postal), mas volume baixo (4 activas, 1 explícita).
- Os dados foram modificados entre abril e setembro de 2026. Antes de carregar, confirmar ocorrências futuras em `scheduled-sessions`.

## 9. Revisão independente (Codex isolado)

**Ronda 0** (cópia `2eae7f5`): veredicto ALTERAÇÕES, com 5 achados, todos confirmados no código e corrigidos com testes.

| # | Achado | Correcção |
|---|---|---|
| 1 | ALTO: frases da fonte (público, evidência, preço) gravadas em staging | Ficam só etiquetas fixas (`audience_tags`, `explicit_older_level`) e valores de preço (ex.: "£8.00 (lunch)"). A guarda de telefone passa a cobrir números internacionais. Títulos com possível nome de pessoa (não fundidos) ficam fora |
| 2 | ALTO: idempotência com leituras sem limite e sem protecção contra execuções concorrentes | Leituras limitadas às séries do plano, com limite explícito e falha se for atingido. Recusa se houver um `ingestion_run` "running" da fonte. Depois da escrita, uma série duplicada faz a execução falhar. **Resíduo:** a garantia atómica exige um índice único na BD (migração, decisão do PO) |
| 3 | MÉDIO: o filtro de elegibilidade da Review API usava só `source_item_id` | O filtro usa a mesma chave da classificação: fonte + id + URL canónica, em `in` e em `not_in`. Uma linha com URL divergente ou de outra fonte cai em `not_audited` |
| 4 | MÉDIO: "older people", "over 55s" e "retired" davam `confirmed_60plus` | Só um limiar 60+ explícito (over 60, 65+, aged 60 and over…) confirma. O resto fica em `likely_suitable` |
| 5 | MÉDIO: o URL de recurso (`url_oficial`) não era validado | Todos os URLs gravados têm de ser do site oficial |

As contagens do dry-run não mudaram: 11 inserções, 27 ocorrências, 8 `likely_suitable` e 3 `unclear`.

**Ronda 1** (cópia `c5589b9`): veredicto ALTERAÇÕES. Os achados 4 e 5 ficaram corrigidos; os 1, 2 e 3 só em parte. Correcções:
- **1:** os URLs gravados têm forma estrita (`https://www.fishhelp.org.uk/event/<slug>/[<data>/]`, sem query, fragmento, credenciais nem codificação). Os 43 URLs reais passam. O `ics_url` gravado é a constante da configuração.
- **2:** cada leitura pede a contagem exacta ao servidor e recusa se não bater com as linhas recebidas. Assim, um corte do servidor abaixo do limite também é detectado.
- **3:** `external_url IS NULL` conta como `not_audited`. Verificado com as linhas reais do staging (só leitura): 133 linhas, 0 URLs nulos, uma só fonte, md5 dos pares igual ao do dataset. Logo, os totais do filtro são 1 / 124 / 7 / 1, e `not_audited` dá 0.

**Ronda 2** (cópia `5369a69`): veredicto ALTERAÇÕES. Os achados 2 e 3 ficaram corrigidos; o 1 só em parte. A correcção 3 (`6df11c9`, última ronda permitida) fecha o 1:
- detecção de telefone nos segmentos variáveis (slug do URL e do `source_item_id`);
- validação do `fuso` (só Europe/London), do código postal (formato britânico) e dos tipos do local.

Os dados reais passam sem alterações.

**Não houve uma 4.ª revisão:** o protocolo pede autorização do PO para isso.

**Resíduos assumidos:**
- corrida entre dois `--apply` sem índice único na BD; é detectada depois da escrita, e o índice exige uma migração;
- pares id/URL trocados entre duas linhas de classes pedidas no filtro: o badge e a guarda 403 usam o lookup exacto.

Relatórios transcritos em `C:\Projects\Vivere\reviews\2026-11-26-UK-62-65-r0.md`, `-r1.md` e `-r2.md`.

## 10. Decisões do PO (26/11/2026) e preparação da escrita FiSH

**Decisões:**
- O Shopping Bus fica fora do piloto.
- As 3 actividades de demência entram na fila de revisão, identificadas pelo público a que se destinam. Nada é aprovado nem publicado automaticamente.
- O PR #64 fica aberto até a Issue #62 estar consolidada.
- Foi autorizada a 4.ª ronda do Codex (só leitura).

**Identificação do público restrito:**
- O colector grava `raw_payload.restricted_audience = {condition, target}`, só com valores enumerados.
- A Review API valida esse valor e gera o rótulo (`audience_restriction`).
- O Admin mostra um badge amarelo na lista (por baixo do título) e no cabeçalho do detalhe.

| Actividade | Rótulo | Proposta |
|---|---|---|
| Picassos in the Park Art | Público restrito: pessoa com demência e cuidador (ambos) | `unclear` |
| Singing for the Brain | Público restrito: pessoa com demência e cuidador (ambos) | `unclear` |
| Retro Club East Sheen | Público restrito: pessoa com perda de memória | `unclear` |

**Simulação do seed:**
- O MCP do staging só permite leitura e recusou o `INSERT` do bloco (`25006 read-only transaction`). Nada foi gravado.
- Simulação equivalente, só de leitura:
  - o produto `vivere-60-plus-uk-test` existe (inactivo);
  - a fonte `fish_neighbourhood_care` ainda não existe, por isso seria **1 linha inserida**;
  - os valores respeitam a PK, a FK para o produto, o CHECK de `source_kind` e os NOT NULL;
  - não há triggers;
  - a única fonte actual do produto é `u3a_richmond` (prioridade 90; a FiSH fica com 80).
- A simulação com o bloco exacto (`v_aplicar := false`) tem de ser corrida pelo PO no SQL Editor do staging.

**Quantidades, duplicados e restrições:**
- 11 actividades e 27 ocorrências; 0 duplicados com a u3a e 0 venues.
- Propostas: 8 `likely_suitable` e 3 `unclear`.
- Restrições:
  - tudo entra em `pending_review`;
  - a guarda 403 impede aprovar ou promover o que não for `confirmed_60plus`, e a FiSH não está no dataset auditado, por isso é `not_audited`;
  - publicar produtos não-BR está bloqueado (publicationGuard).

**Rollback:** `scripts/staging/fish-rollback.staging.sql`.
- Funcionamento:
  - simulação por omissão;
  - apaga só o que é da FiSH, por esta ordem: `activities_staging` → `raw_activity_items` → `ingestion_runs` e, opcionalmente, `sources`;
  - recusa se houver revisão humana, Entity Resolution, uma run em curso ou venues FiSH.
- As verificações foram validadas por leitura no staging (todas a 0) e as colunas confirmadas no catálogo.

**4.ª revisão do Codex** (ronda 3, autorizada pelo PO, só leitura; cópia `e940ffb`): veredicto ALTERAÇÕES, com 5 achados. Todos foram confirmados e corrigidos com testes; **não foram re-revistos** (uma 5.ª ronda precisa do PO).

| # | Achado | Correcção |
|---|---|---|
| 1 | ALTO: o rollback (e o seed) não identificavam o projecto | Exigem o marcador do staging: a primeira run u3a do piloto, com id e hora exactos, que só existe ali. Validado por leitura |
| 2 | ALTO: corrida entre a avaliação e o DELETE do rollback | `LOCK` das três tabelas em SHARE ROW EXCLUSIVE. Os DELETE repetem as condições e comparam as contagens com as avaliadas; qualquer diferença aborta |
| 3 | MÉDIO: o rollback apagava pela fonte e não pelo produto | O alvo passa a ser fonte FiSH **e** produto do piloto. Recusa se houver raw FiSH noutro produto, runs FiSH com venues ou items de outra fonte |
| 4 | ALTO: telefones em grupos 2-4-4 nos slugs; `reserva` sem validação | O detector soma grupos numéricos consecutivos. `reserva`, os booleanos, as listas e o custo são validados em runtime |
| 5 | MÉDIO: Parkinson e AVC rotulados como perda de memória; "carers of people with dementia" dado como ambos | O badge só aparece para demência ou perda de memória (Parkinson e AVC continuam `unclear`, sem badge). "Carers of…" passa a cuidador |

Os rótulos reais não mudam: Picassos e Singing for the Brain → ambos; Retro Club → pessoa com perda de memória.

## 12. Descoberta alargada (26/11/2026, tarde): matriz por fonte

Só leitura e dry-run: nada foi gravado. As investigações web foram feitas por agentes, sempre pela ordem robots.txt → termos → páginas permitidas.

| Fonte | Actividades reais | Evidência 60+ | Datas / horários / locais / custos | Ingestão estruturada | Duplicados (u3a 133 + FiSH 11) |
|---|---|---|---|---|---|
| **FiSH** | 11 séries (27 ocorrências) | Só a da organização ("older community"); 0 explícitas. 3 com público restrito (demência) | Completos em 8 de 11; custo só em 2 | **Pronta**: ICS + snapshot; `--apply` espera autorização | 0 |
| **Richmond Council / Full of Life** | 13 em páginas oficiais: a feira de 30/10 (já realizada, anual); 6 sessões da Age UK em bibliotecas (ter. 10–16h, 08/12/2026 a 23/03/2027); 6 regulares do directório "Cost of Living" (actualizado a 29/05/2026: Community Spaces da Age UK para "over 60", almoços Linden Hall "over 55", St Stephen's £3.50, Ham & Petersham SOS) | Explícita em 10 (feira 55+, "over 60", "older people", "over 55", "elderly") | Datas futuras só nas 6 das bibliotecas (sem código postal); as regulares têm horários por confirmar | **Baixa**: sem ICS, RSS, JSON-LD nem API. Os termos proíbem a reutilização sem autorização; a OGL só cobre estatísticas | 0 de título. Local em comum: Barnes Green Centre (SW13 9HE) é também da FiSH |
| **Better (OpenActive)** | 10 séries em Richmond (Teddington Pools, Pools on the Park, Better Gym Teddington), 4 activas | 1 explícita: "Swim for 60+" (`ageRange` mín. 60, seg.–sex. 09:30–10:25, Pools on the Park TW9 2SF) | Preço Adult £6.90–£11.70; "Swim for 60+" sem preço indicado | **Técnica alta, mas pesada.** CC BY 4.0. `session-series` completo em 5 páginas. `scheduled-sessions` tem 40 páginas lidas (20 000 sessões, 29 MB) sem chegar ao fim e sem sessões de Richmond: as séries de Richmond foram modificadas entre abril e setembro de 2026 e ficam mais adiante no feed. Confirmar exige uma leitura completa (ou incremental pelo cursor RPDE) | 0 (u3a "Swimming 1" é outro organizador) |
| **Age UK Richmond** | Não recolhidas (os termos proíbem) | — | — | **Bloqueada** até haver autorização escrita. Contacto oficial: info@ageukrichmond.org.uk | — |
| **Ruils** | Não registadas: o agente parou nos termos | — | — | **Bloqueada**: a "Website User Policy" proíbe publicar sem autorização escrita | — |

**Registo de conformidade:** na Ruils, o agente leu a página de política e a de actividades em simultâneo. Isso violou o Crawl-delay 10 nesse par de pedidos e fez a página de actividades ser lida antes dos termos. Não houve 429 nem 403, e o conteúdo dessa página não foi guardado.

**Organizações para descobrir mais fontes** (directório do Council e expositores da feira): Ham and Petersham SOS, Linden Hall, Greenwood Centre, Teddington and Hampton Wick Voluntary Care Group, Richmond Good Neighbours, HANDS, Whitton Network, Arts Richmond, Richmond Ramblers, Stable & Strong, Your Community Centres, Sheddington, Probus, Alzheimer's Society (Singing for the Brain, já na FiSH), AquaPhysio, TW2 Club. Cada uma precisa da sua leitura de robots.txt e termos.

## 13. Matriz consolidada (26/11/2026, fim do dia): pronto / autorização / descarte

**Critérios do PO:**
- actividades reais com datas futuras verificáveis, elegibilidade 60+ verificável e local em Richmond;
- eventos gerais 18+ não contam como 60+;
- só se ingere uma fonte com permissão de reutilização confirmada.

**No staging (SELECT):** u3a 133 + FiSH 11 = **144**, todas em `pending_review`; 26 venues. Nada novo foi gravado desde então.

### Prontas para ingestão em staging
**Nenhuma.** Nenhuma fonte nova cumpre ao mesmo tempo os três critérios: licença confirmada, datas futuras confirmadas e sinal 60+.

### Exigem autorização externa (pedidos em `PEDIDOS-AUTORIZACAO-FONTES-RICHMOND.md`, PR #66, não enviados)
| Fonte | Registos verificados | Elegibilidade | Datas |
|---|---|---|---|
| H&HHVC / Greenwood (curadoria, PR #66) | 4: Women's Social Group (qui. 13:30–15:15), Men's Social Group (ter. 13:30–15:30), **FLexercise Over 60s** (qui. 14:15–15:15), Parkinson's Exercise Class (qui. 12:00–13:30), todas no Greenwood Community Centre, TW12 1QL | 1 explícita 60+, 2 da organização para pessoas mais velhas, 1 condição de saúde (`unclear`) | horário semanal publicado na página |
| Richmond Good Neighbours (curadoria, PR #66) | 1: Cambrian Teas, 2.ª quarta-feira, 14:30–15:30, TW10 6SN | `likely_suitable` (organização para "elderly and housebound") | horário mensal publicado |
| Age UK Richmond | Não recolhidas (os termos proíbem) | — | — |
| Ruils | Não recolhidas (a política proíbe publicar) | — | — |
| Richmond Council | 13 identificadas (§12), não recolhidas: os termos são "personal and non commercial use" e não há dados abertos de eventos | 10 explícitas (55+/60+/older) | 6 com datas futuras (bibliotecas, dez./2026 a mar./2027) |
| Stable & Strong | 1: "Strength over Sixty" (explícita 60+, SW14 8HR) | explícita | horário só em imagem: pedir o horário ao estúdio |
| Sheddington; Ramblers | não recolhidas (termos da e-voice; o robots.txt deu 403) | — | — |

### Exigem verificação antes de qualquer decisão
| Fonte | Registo | Motivo |
|---|---|---|
| Better (OpenActive, CC BY 4.0, PR #67) | **Swim for 60+**, Pools on the Park TW9 2SF, seg. a sex. 09:30–10:25 (`ageRange` mín. 60) | A licença está confirmada, mas **não há sessões futuras confirmadas**. O feed `scheduled-sessions` foi lido até ao fim (72 páginas, 35 228 sessões) e não tem nenhuma sessão desta série nem das outras 9 de Richmond. O horário da série vem de 2025 e não tem data de fim. O robots.txt de better.org.uk proíbe o timetable automático, por isso só uma verificação manual ou um contacto com a Better a confirma. Com `--sessions`, o dry-run insere 0 |
| Playwaze, Bookwhen (OpenActive, CC BY 4.0) | Têm sessões do tipo certo (tai chi para seniors, strength and balance, chair yoga, Zumba Gold), mas fora de Richmond nas páginas lidas | Para ter a certeza é preciso uma leitura completa e controlada de cada feed, como a da Better |
| Everyone Active, Lampton Leisure (OpenActive) | não verificados | Ficaram fora do limite de pedidos |

### Descartar
| Fonte | Registos | Motivo |
|---|---|---|
| Better | 6 séries activas gerais (Aqua Aerobics, Swim for all ×2, Group Cycle, Zumba, Family Fun Swim) + 3 expiradas | Gerais 16+/família, sem sinal 60+; e também sem sessões futuras no feed |
| GoodGym (OpenActive) | 6 eventos em TW1/TW9/TW10 (28/11 a 14/12) | Corridas de voluntariado 18+, não são 60+ |
| England Netball (OpenActive) | 1 série "Back to Netball" de 2015 (TW1 3BB) | Histórica |
| Open Sessions (London Sport) | — | O feed só tem apagamentos (desactivado) |
| Greenwood (curadoria) | 6 aulas de terceiros, Book Club, Brighter Together, Singing for the Brain (Hampton Hill) | Sem sinal 60+ ou sem horário fixo |
| Richmond Good Neighbours | Shopping Bus, Transport, Shopping, Befriending | Serviços, não actividades |
| Richmond AquaPhysio Group | 10 sessões de hidroterapia | Serviço terapêutico 18+ |
| Ham & Petersham SOS; Linden Hall; Whitton Network; Your Community Centres; TW2 Club | — | Site oficial inacessível (TLS ou certificado), em manutenção ou não encontrado |

**Volume de pedidos e conformidade:**
- Better: 72 + 2 pedidos ao feed de sessões e 6 ao feed de séries.
- Catálogo OpenActive: 36 pedidos.
- Todos com o robots.txt lido primeiro e sem 429/403.
- Sem dados pessoais e sem chamadas pagas.
