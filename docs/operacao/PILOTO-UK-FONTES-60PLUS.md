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
