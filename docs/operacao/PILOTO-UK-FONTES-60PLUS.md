# Piloto Richmond UK: fontes novas de actividades 60+ (viabilidade e preview)

**Data:** 26/11/2026. **Produto:** `vivere-60-plus-uk-test`, só staging.

**Estado:** preview/dry-run. **Nada foi gravado** em base de dados: sem ingestion_run, sem raw items e sem staging.

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
| 5 | **Better (GLL)** | Site próprio; reservas Innovatise | **Sim**: OpenActive, **CC BY 4.0**, no catálogo oficial. `https://better-admin.org.uk/api/openactive/better/session-series` e `/scheduled-sessions` (RPDE 1.0) | robots de better.org.uk proíbe `*/timetable?*`, `*/api/innovatise/*` e `*start_date*`. O robots de better-admin.org.uk não foi verificado. Os feeds são **nacionais** (páginas de ~3,75 MB) | Fraca: "over 50s", "older adults" misturado com outros públicos, preços "Senior/60+". Nenhuma sessão 60+ recorrente confirmada em Richmond | ~5–8 ofertas (concessões e aulas "Basics"); a cobertura de Richmond não está confirmada | **Técnica: alta** (dados abertos e licenciados). **Relevância: baixa-média** | **Spike** de colector OpenActive: ler o feed completo e filtrar por códigos postais de Richmond e por ageRange ou termos de idade |

**Total realista hoje:** 13 séries novas (FiSH).
- **Com consentimento da Age UK e curadoria:** até ~45–50 itens (FiSH 13, Age UK ~17, Ruils 1–4, Better 5–8).
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

1. **FiSH, gravação em staging:**
   - seed da fonte `fish_neighbourhood_care` (como em U4);
   - um `scripts/ingest-fish.ts` (modo real com `envGuard`, usando `runActivityIngestion`);
   - ajuste da verificação cruzada para fontes ICS (limitação 2);
   - revisão humana das 13 propostas antes de entrarem num dataset auditado `…v2`.
2. **Age UK:** enviar um pedido de consentimento escrito (cl. 8 dos termos) a explicar o uso: listagem com link para a fonte, sem reproduzir o texto. Sem resposta, só curadoria manual de factos (título, dia, hora, local e link) e decisão jurídica do PO.
3. **Better:** spike offline do feed OpenActive (CC BY 4.0, com atribuição "Better"):
   - ler o robots de better-admin.org.uk;
   - percorrer o RPDE com limite;
   - filtrar por TW1/TW2/TW9/TW10/TW11/TW12/SW13/SW14;
   - medir quantas sessões têm sinal 60+.
4. **Ruils:** ler os termos. Depois, curadoria manual de "Embracing Age" e dos grupos "all ages", ou parser HTML respeitando o Crawl-delay 10.
5. **Council / Full of Life:** extrair do PDF do programa só a lista de organizações expositoras, para descobrir fontes novas. Não é feed de actividades.
