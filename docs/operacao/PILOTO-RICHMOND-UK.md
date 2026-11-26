# Piloto Richmond upon Thames (GB) — descoberta, dry-run e proposta estrutural

**Data:** 26/11/2026 · **Âmbito:** só staging · **Estado:** descoberta concluída. **Nenhuma escrita em BD, nenhuma publicação, nenhuma alteração estrutural executada.**
**Antecedente:** ADR-0010 (UK pilot adiado). Usa o mesmo centro, `51.4613, -0.3037`, que coincide com o centro do mapa da Visit Richmond.

## 1. Resposta curta
- **A ingestão em staging não foi executada, porque a arquitectura actual não o permite sem alterações estruturais (§4):**
  1. não existe um colector para nenhuma das fontes de Richmond;
  2. o parser de recorrência e as datas são só pt-BR;
  3. o produto e as fontes não existem em `public.products` / `public.sources`, e as FKs obrigam a que existam;
  4. o fuso `-03:00` está fixo na publicação.
- **Em vez disso foi feito um dry-run de descoberta, só leitura.**
  - Fez leituras HTTP públicas das 4 fontes e extraiu os dados sem os gravar em lado nenhum.
  - Os resultados estão no §3 e nos anexos A1–A4.
- **A melhor fonte é a Richmond u3a:**
  - tem uma API WordPress pública com eventos, grupos e locais estruturados;
  - **146 grupos activos**, 17 eventos datados (1 futuro válido) e 54 locais.

## 2. Fontes oficiais avaliadas

| Fonte | URL | Plataforma | Acesso automático | Conteúdo 60+ | Avaliação |
|---|---|---|---|---|---|
| **Richmond u3a** (charity 1012343) | https://rut.u3asite.uk/ | WordPress (u3a SiteWorks) | **WP REST pública**: `u3a_event`, `u3a_group`, `u3a_venue`. O robots.txt só bloqueia `/wp-admin/` | Exclusivo 3.ª idade (só para membros) | **Fase 1** |
| **Richmond Libraries** (Council) | https://richmond.gov.uk/services/libraries/libraries_whats_on/talks_and_events_in_libraries | Umbraco (HTML) | Só HTML: 1 página, sem API nem iCal | Série "Health and wellbeing support events" para pessoas mais velhas | **Fase 1b**: parser HTML pequeno ou curadoria manual |
| **Age UK Richmond** | https://www.ageuk.org.uk/richmonduponthames/activities-and-events/ | Episerver (HTML) | Só HTML: tabelas de texto livre, datas **sem ano**, subpáginas que redireccionam | Exclusivo 60+ | **Fase 2**: curadoria manual (`curadoria_manual`), por ser frágil |
| **Richmond Council: eventos** | `richmond.gov.uk/events` → https://www.visitrichmond.co.uk/events | Simpleview/New Mind (listagem por JS) | Sem feed público identificado | Turístico e geral; não é 60+ | **Fora do piloto** (eventualmente "Inclusive and Accessible Events") |

**Configuração alvo:** país `GB`, idioma `en-GB`, fuso `Europe/London` (com horário de verão BST/GMT), `product_key` `vivere-60-plus-uk-test` (ADR-0010).

## 3. Dry-run de descoberta (26/11/2026, só leitura)

### 3.1 Richmond u3a, via WP REST
- **Eventos datados (`u3a_event`): 17.**
  - **Campos estruturados:** `eventdate`, `eventstarttime`, `eventendtime`, `eventcategory`, `eventgroup`.
  - **Futuros: 2.**
    - 16/12/2026 12:00, "December Christmas Pub Lunch", The King's Head (TW11 8HG), Social. Exige reserva.
    - 16/12/2026 14:30–15:30, Monthly Meeting em Clarendon Hall. **CANCELADO**: o título começa por "CANCELLED", não há campo de estado.
  - Os outros 15 já passaram. Lista completa no anexo A1.
- **Grupos recorrentes (`u3a_group`): 147, dos quais 146 activos.**
  - Vagas: 102 abertos, 39 com lista de espera, 5 fechados.
  - **Horário:** é texto livre em inglês no campo "When".
    - Exemplos: "Weekly on Thursday mornings 10:00 AM-11:00 AM", "Monthly on Wednesdays 12:00 PM", "Fortnightly on Monday afternoons 2:30 PM-4:30 PM".
    - 133 indicam o dia da semana e 121 a hora.
  - **Frequência:**

    | Frequência | Grupos |
    |---|---|
    | Semanal | 40 |
    | Quinzenal | 33 |
    | Mensal | 57 |
    | Outra ou indefinida | 16 |

  - **Local:** em 24 grupos não há local. Há ainda 12 com "Various locations", **11 em casa de membros (excluídos por privacidade)** e 3 online.
  - **Categorias da fonte:** Recreation, Social, Languages (FR/ES/IT/DE), Literature, Music, Sport, Walking, Art, History, Drama, Gardens, IT, Food & Wine e outras.
  - Lista completa no anexo A2.
- **Locais (`u3a_venue`): 54.**
  - 27 têm morada com código postal.
  - 24 são só um nome de bairro (ex.: "Teddington", "Kew"), por isso não são geocodificáveis sem curadoria.
  - 2 são online e 1 é privado.
  - Alguns códigos KT ficam na fronteira do borough. O gate geográfico decide, mas precisa de coordenadas.
  - Anexo A3.

### 3.2 Richmond Libraries, via HTML
- Página actualizada a 27/10/2026.
- **Série "Health and wellbeing support events"**: informação para pessoas mais velhas sobre dinheiro, benefícios, tecnologia e demência, das **10:00 às 16:00**.

| Data | Biblioteca | Estado |
|---|---|---|
| 27/10/2026 (ter) | East Sheen Library | passado |
| 24/11/2026 (ter) | Ham Library | passado |
| **08/12/2026 (ter)** | Richmond Lending Library | futuro |
| **26/01/2027 (ter)** | Hampton Library | futuro |
| **09/02/2027 (ter)** | Teddington Library | futuro |
| **23/02/2027 (ter)** | Richmond Lending Library | futuro |
| **09/03/2027 (ter)** | Twickenham Library | futuro |
| **23/03/2027 (ter)** | Whitton Library | futuro |

- A página não traz a morada das bibliotecas. Teria de vir do registo oficial de bibliotecas do Council, numa curadoria única.

### 3.3 Age UK Richmond, via HTML (amostra; sem extracção automática)
- **"Social events, short courses, talks & webinars"**, uma tabela Actividade / Data-Local / Custo:
  - **Friday Bingo**: sextas alternadas a partir das 13:00, Barnes Green Centre, £1.
  - **Christmas Wreath Making Workshop**: "Tuesday 1st December at 7pm or Wednesday 2nd December at 3.30pm", Twickenham Wellbeing Centre (TW1 3NH), £28 mais donativo. A data não tem ano; infere-se 2026.
  - **Christmas Market**: "Saturday 7 November" (já passou).
  - Há também sessões regulares: segundas das 10:00 às 12:00 e das 13:00 às 15:00 no Barnes Green Centre, e Walking Football à terça das 10:00 às 11:00 na St Mary's University Teddington.
- **Problemas:**
  - as subpáginas `keep-well` e `socialise` redireccionam para a página-mãe;
  - os horários estão em PDF e as datas não têm ano.
  - A extracção automática seria frágil, por isso recomenda-se curadoria manual.

### 3.4 Erros e riscos encontrados
1. **Dados pessoais nas fontes.**
   - Os grupos e eventos da u3a trazem o nome do líder ou do organizador, o telefone e um formulário de contacto.
   - O dry-run **descarta-os antes de qualquer saída**: só guarda Status, When, Venue, categoria, datas e URL.
   - O colector definitivo tem de fazer o mesmo. Hoje, os colectores WordPress gravam `contact_phone`.
2. **Locais privados** ("Members Home"): 11 grupos ficam excluídos.
3. **Actividades só para membros.** A u3a exige inscrição anual. Isto tem de ser dito na ficha, por exemplo "Members only — join Richmond u3a".
4. **Cancelamento só no título** ("CANCELLED - …"). É preciso detectá-lo e não publicar.
5. **Datas sem ano** (Age UK) e **horários em texto livre** (u3a "When"). Ver a regra ADR-0003 "nunca inventar": um "When" sem hora fica sem hora.
6. **Locais só com o bairro.** Não há coordenadas, por isso o gate geográfico não decide sozinho.
7. **O fuso horário muda.** O Reino Unido tem horário de verão; o Brasil não tem desde 2019.

## 4. Lacunas da arquitectura actual (verificadas no código e no schema de staging)

| # | Lacuna | Onde | Bloqueia |
|---|---|---|---|
| G1 | Não há colector para a u3a SiteWorks. O `WordPressContentCollector` só lê `posts`, com parsers em PT (`datePt`, labels em PT) | `src/collectors/wordpress-content/*` | ingestão |
| G2 | A recorrência só é detectada em pt-BR e só para semanal ("segunda", "toda terça"…) | `src/pipeline/stages/02-recurrence-detection/detectRecurrence.ts` | ingestão de grupos |
| G3 | O produto `vivere-60-plus-uk-test` e as fontes (`u3a_richmond`, …) não existem. Há FKs `→ public.products` / `public.sources` em `raw_*`, `*_staging` e `ingestion_runs` | schema de staging | ingestão |
| G4 | `RegionDefinition` não tem `country`, `locale` nem `timezone` (tem `state` = UF); falta a entrada de Richmond | `src/config/regions.ts` | configuração |
| G5 | Fuso fixo em `SOURCE_LOCAL_UTC_OFFSET = '-03:00'` e a SQL `active_activities` usa `America/Sao_Paulo` (0029) | `src/publishing/services/occurrenceSelection.ts`, migração 0029 | **publicação** (não a ingestão) |
| G6 | `languageCode: 'pt-BR'` fixo no Google Places, e regras do Venue Filter só em PT | `GooglePlacesApiClient.ts`, `00-filter-venue` | descoberta de venues por Places (não usada no piloto) |
| G7 | Geocodificação dos locais da u3a: só a morada e o código postal, sem coordenadas | — | gate geográfico |

## 5. Proposta estrutural (NADA executado; cada fase com autorização própria)

| Fase | O quê | Ambiente | Tipo | Custos |
|---|---|---|---|---|
| **U0** | Este documento e o dry-run | — | docs | 0 |
| **U1** | Configuração da região: em `RegionDefinition`, `country`/`locale`/`timezone` opcionais (defaults BR, por isso zero regressão) e a entrada `richmond_upon_thames` (GB, en-GB, Europe/London, centro ADR-0010, raio 8 km, `state` = "London") | código | PR, testes com fakes | 0 |
| **U2** | Colector `u3a-siteworks`, só GET na WP REST pública | código | PR, testes com fixtures sintéticas | 0 |
| **U3** | Parser de recorrência EN | código | PR, testes | 0 |
| **U4** | Dados de staging: 1 linha em `public.products` e 1–3 em `public.sources`, no projecto de **staging** | staging | INSERT de configuração | 0 |
| **U5** | Geocodificação dos 27 códigos postais: (a) curadoria manual, ou (b) postcodes.io | staging | dados | 0 |
| **U6** | **Primeira ingestão em staging** (colector → raw → normalização → dedup/ER → gate) com `--dry-run` primeiro e depois escrita | staging | execução pelo PO (precisa das credenciais de staging, a que o Claude não acede) | 0 |
| **U7** | Libraries e Age UK como `curadoria_manual`, ou um parser HTML pequeno para Libraries | staging | dados / PR | 0 |
| **U8** | Fuso por região na publicação (G5) **antes de qualquer publicação UK**. Até lá, uma guarda que recusa `publish` para produtos que não sejam BR | código e migração | PR; a migração precisa de REF | 0 |

**Pormenor das fases de código:**
- **U2, colector `u3a-siteworks`:**
  - lê `u3a_event`, `u3a_group` e `u3a_venue`;
  - **filtro de privacidade:** descarta líder, telefone, email, organizador e reservas; exclui "Members Home";
  - detecta os cancelamentos;
  - grava `language: 'en'`;
  - mantém o "When" literal.
- **U3, parser de recorrência EN:**
  - reconhece "Weekly / Fortnightly / Monthly on <Day>", "1st/3rd <Day>" e horas "10:00 AM-11:00 AM";
  - fica isolado por `language`, por isso o caminho PT não muda;
  - nunca inventa uma hora ausente.
- **U5, geocodificação:**
  - (b) é a API de dados abertos do Reino Unido, gratuita, sem chave e sem contrato;
  - **a usar só com autorização**;
  - (a) não tem nenhum serviço externo.

**Isolamento:**
- tudo usa o produto `vivere-60-plus-uk-test`;
- o Publishing Engine é executado por `productKey` e nada é publicado sem uma execução manual;
- produção: zero alterações.
- **Sem custos novos:** não usa Google Places no piloto, porque os locais vêm das fontes.

**Recomendação:**
- autorizar **U1, U2, U3 e U4** (PRs e a configuração em staging);
- para o U5, escolher entre (a) e (b);
- depois disso, o U6 (primeira ingestão real em staging) pode ser corrido pelo PO.

## 6. Anexos
- **A1–A3:** abaixo, gerados pelo dry-run, sem dados pessoais.
- **A4 (Libraries):** é a tabela do §3.2.
- **Reprodução:** o dry-run consistiu em leituras GET públicas da WP REST e de 3 páginas HTML, com scripts locais fora do repositório. Nada foi gravado em nenhuma BD.

### A1. Richmond u3a — eventos datados (u3a_event, 17 no total)

| Data | Início | Fim | Categoria | Título | Local | Estado | URL |
|---|---|---|---|---|---|---|---|
| 2026-12-16 | 12:00 | — | Social | December Christmas Pub Lunch | The King's Head | futuro | https://rut.u3asite.uk/u3a_events/december-christmas-pub-lunch/ |
| 2026-12-16 | 14:30 | 15:30 | Meeting | CANCELLED - MONTHLY MEETING, Clarendon Hall, Twickenham | Clarendon Hall | CANCELADO | https://rut.u3asite.uk/u3a_events/monthly-meeting-clarendon-hall-york-house/ |
| 2026-11-25 | 14:30 | 15:30 | Meeting | MONTHLY MEETING, Clarendon Hall Twickenham | Clarendon Hall | passado | https://rut.u3asite.uk/u3a_events/monthly-meeting-at-2-30pm-in-clarendon-hall-york-house/ |
| 2026-11-18 | 12:00 | — | Social | November Pub Lunch | The Crown | passado | https://rut.u3asite.uk/u3a_events/november-pub-lunch/ |
| 2026-10-28 | 14:30 | 15:30 | Meeting | MONTHLY MEETING, Clarendon Hall, Twickenham | Clarendon Hall | passado | https://rut.u3asite.uk/u3a_events/monthly-meeting-at-2-30pm-in-clarendon-hall-york/ |
| 2026-10-21 | 12:00 | 14:00 | Social | October Pub Lunch | Various locations | passado | https://rut.u3asite.uk/u3a_events/october-pub-lunch/ |
| 2026-09-30 | 14:30 | 15:30 | Meeting | MONTHLY MEETING, Clarendon Hall Twickenham | Clarendon Hall | passado | https://rut.u3asite.uk/u3a_events/monthly-meeting-clarendon-hall-twickenham-2/ |
| 2026-09-16 | 12:00 | — | Social | September Pub Lunch | Twickenham | passado | https://rut.u3asite.uk/u3a_events/pub-lunch-6/ |
| 2026-08-26 | 14:30 | 15:30 | Meeting | MONTHLY MEETING, Clarendon Hall, Twickenham | Clarendon Hall | passado | https://rut.u3asite.uk/u3a_events/monthly-meeting-clarendon-hall-twickenham/ |
| 2026-07-15 | 12:00 | — | Social | Pub Lunch | Various locations | passado | https://rut.u3asite.uk/u3a_events/pub-lunch-5/ |
| 2026-04-29 | 14:30 | 15:30 | Meeting | MONTHLY MEETING, St Mary's Church, Twickenham | St Mary's Church | passado | https://rut.u3asite.uk/u3a_events/monthly-meeting-at-2-30pm-in-clarendon-hall-york-house-2/ |
| 2026-04-15 | 12:00 | 14:00 | Group meeting | Pub Lunch | The Foresters Arms | passado | https://rut.u3asite.uk/u3a_events/pub-lunch-4/ |
| 2026-03-25 | 14:30 | 14:45 | Meeting | AGM - 2026 | St Mary's Church | passado | https://rut.u3asite.uk/u3a_events/agm-2026/ |
| 2026-02-18 | 12:00 | 14:00 | Group meeting | Pub Lunch | The Crown | passado | https://rut.u3asite.uk/u3a_events/pub-lunch/ |
| 2025-12-17 | 12:00 | 14:00 | Group meeting | Pub Lunch | The King's Head | passado | https://rut.u3asite.uk/u3a_events/pub-lunch-2/ |
| 2025-01-30 | 10:30 | 12:30 | Fair | Health, Wealth and Happiness Fair | Whitton Community Centre | passado | https://rut.u3asite.uk/u3a_events/health-wealth-and-happiness-fair/ |
| 2025-01-20 | 14:30 | 16:30 | Group meeting | Tomorrow's World | ETNA | passado | https://rut.u3asite.uk/u3a_events/tomorrows-world/ |

### A2. Richmond u3a — grupos recorrentes activos (u3a_group, 146 de 147)

Horário = texto "When" da fonte, sem interpretação. Os locais em casa de membros aparecem mascarados e ficam excluídos.

| # | Grupo | Categoria | Quando (fonte) | Local (fonte) | Vagas | URL |
|---|---|---|---|---|---|---|
| 1 | ?Could you start a new Group? | General | Plenty of vacancies! | — | aberto | https://rut.u3asite.uk/u3a_groups/could-you-start-a-new-group/ |
| 2 | Architecture - Modern | Art | Monthly on Wednesday mornings 10:30 AM Waiting list | Kew | lista de espera | https://rut.u3asite.uk/u3a_groups/architecture-modern/ |
| 3 | Art - A Taste of Art | Art | Monthly on Wednesday afternoons 1:00 PM-3:30 PM Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/art-a-taste-of-art/ |
| 4 | Art - Found Art | Art | Monthly on Fridays | ZOOM (online) | aberto | https://rut.u3asite.uk/u3a_groups/art-found-art/ |
| 5 | Art History and Heritage | Art | Monthly on Wednesdays | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/art-history-and-heritage/ |
| 6 | Art Workshop | Art | Fortnightly on Friday afternoons 1:00 PM-3:00 PM Waiting list | St Margarets | aberto | https://rut.u3asite.uk/u3a_groups/art-workshop/ |
| 7 | Badminton 1 | Sport | Weekly on Monday afternoons 5:00 PM-6:00 PM | Orleans Park School | aberto | https://rut.u3asite.uk/u3a_groups/badminton-1/ |
| 8 | Badminton 2 | Sport | Weekly on Monday afternoons 1:00 PM-2:00 PM Vacancies | All Hallows' Church | aberto | https://rut.u3asite.uk/u3a_groups/badminton-2/ |
| 9 | Badminton 3 | Sport | Weekly on Thursday afternoons 2:00 PM-3:00 PM Vacancies | All Hallows' Church | aberto | https://rut.u3asite.uk/u3a_groups/badminton-3/ |
| 10 | Birdwatching Walks- beginners | Walking | Monthly mornings 10:00 AM-12:00 PM Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/birdwatching-walks-beginners/ |
| 11 | Bolivia (version of card game Canasta) | Section: Recreation | Weekly on Wednesday afternoons | Park Hotel Teddington | aberto | https://rut.u3asite.uk/u3a_groups/bolivia/ |
| 12 | Book Group - Biographies&#038;More | Literature | Monthly on Wednesday mornings 10:30 AM-12:00 PM 2nd Wednesday | Park Hotel Teddington | lista de espera | https://rut.u3asite.uk/u3a_groups/book-group-biographies-and-more/ |
| 13 | Book Group - Classics | Literature | Monthly on Wednesday mornings 10:30 AM-12:30 PM Waiting list | Richmond | aberto | https://rut.u3asite.uk/u3a_groups/book-group-classics/ |
| 14 | Book Group - Literature | Drama, History & Philosophy, Literature | Fortnightly on Tuesday mornings 10:15 AM-12:15 PM 1st and 3rd Tuesdays of month | Hampton | lista de espera | https://rut.u3asite.uk/u3a_groups/book-group-literature/ |
| 15 | Book Group - Mainly Classics | Literature | Monthly on Wednesday afternoons 2:00 PM-4:00 PM 1st Wednesday in month | Ham | aberto | https://rut.u3asite.uk/u3a_groups/book-group-mainly-classics/ |
| 16 | Book Group - Members' Choice | Literature | Monthly on Tuesday afternoons 2:30 PM-4:00 PM 3rd Tuesday in month | Kew Green | lista de espera | https://rut.u3asite.uk/u3a_groups/book-group-members-choice-1/ |
| 17 | Book Group- Alternative | Literature | Monthly on Wednesday mornings 11:00 AM-1:00 PM 1st Wednesday in month | The Castlebar | aberto | https://rut.u3asite.uk/u3a_groups/book-group-alternative/ |
| 18 | Book Group-Fiction & Non-Fiction | Literature | Monthly on Wednesday mornings 10:30 AM-12:30 PM 1st Wednesday | The Anglers Pub | aberto | https://rut.u3asite.uk/u3a_groups/book-group-fiction-non-fiction/ |
| 19 | Book Group-Literature 2 | Literature | Monthly on Tuesday mornings 10:00 AM-11:30 AM 1st Tuesday in month | Park Hotel Teddington | fechado | https://rut.u3asite.uk/u3a_groups/literature-in-the-modern-world/ |
| 20 | Book Group-Wonderful World of | Literature | Monthly on Wednesday mornings 11:15 AM-12:30 PM 2nd Wednesday in month | Park Hotel Teddington | lista de espera | https://rut.u3asite.uk/u3a_groups/book-grp-wonderful-world-of-books/ |
| 21 | Bridge | Social | Fortnightly on Monday afternoons 2:30 PM-4:30 PM | East Sheen | aberto | https://rut.u3asite.uk/u3a_groups/bridge/ |
| 22 | Bridge - Social | Social | Weekly on Thursday afternoons 2:00 PM-4:00 PM Vacancies | (casa de membro — excluído) | aberto | https://rut.u3asite.uk/u3a_groups/bridge-1-social/ |
| 23 | Chess | Social | Fortnightly on Friday afternoons 2:00 PM-4:00 PM Vacancies | ETNA | aberto | https://rut.u3asite.uk/u3a_groups/chess/ |
| 24 | Choral Music Appreciation | Music | Monthly on Tuesday afternoons 2:00 PM-3:15 PM First Tuesday | Hampton | aberto | https://rut.u3asite.uk/u3a_groups/choral-music-appreciation/ |
| 25 | Church Bell Ringing | Music | Weekly on Wednesday mornings 10:30 AM-12:00 PM Vacancies | All Hallows' Church | aberto | https://rut.u3asite.uk/u3a_groups/church-bell-ringing/ |
| 26 | Cinema Group | Drama | Monthly afternoons Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/cinema-group/ |
| 27 | Classical Music Appreciation | Music | Monthly on Monday afternoons 3:00 PM-5:00 PM Meet in term time. | (casa de membro — excluído) | aberto | https://rut.u3asite.uk/u3a_groups/classical-music-appreciation/ |
| 28 | Classical Music Concerts | Music | Monthly | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/classical-music-concerts/ |
| 29 | Cookbook Club | Food & Wine | Monthly on Thursday mornings 10:30 AM-1:00 PM 3rd Thursday | (casa de membro — excluído) | aberto | https://rut.u3asite.uk/u3a_groups/cookbook-club/ |
| 30 | Cookery-South East Asian | Food & Wine | Monthly on Tuesday mornings 11:00 AM-12:00 PM for 4 months | (casa de membro — excluído) | lista de espera | https://rut.u3asite.uk/u3a_groups/cooking-demonstration-group/ |
| 31 | Cryptic Crosswords 1 | Social | Fortnightly on Thursday afternoons 2:30 PM-3:30 PM Waiting list | ZOOM (online) | lista de espera | https://rut.u3asite.uk/u3a_groups/cryptic-crosswords-1/ |
| 32 | Cryptic Crosswords 2 | Social | Monthly on Thursday afternoons 2:30 PM-4:30 PM 2nd Thursday | (casa de membro — excluído) | lista de espera | https://rut.u3asite.uk/u3a_groups/cryptic-crosswords-2/ |
| 33 | Cryptic Crosswords 3 | Social | Monthly on Thursday afternoons 2:30 PM-4:30 PM 3rd Thursday | (casa de membro — excluído) | aberto | https://rut.u3asite.uk/u3a_groups/cryptic-crosswords-3/ |
| 34 | Current Affairs | Philosophy | Monthly on Monday afternoons 2:00 PM-4:30 PM 2nd Monday | Kew Green | lista de espera | https://rut.u3asite.uk/u3a_groups/current-affairs/ |
| 35 | Current Affairs 2 | Philosophy | Monthly on Tuesday afternoons 2:30 PM-4:00 PM 1st Tuesday of month | Petersham | aberto | https://rut.u3asite.uk/u3a_groups/current-affairs-2/ |
| 36 | Cycling | Sport | Monthly on Monday mornings 10:00 AM-1:00 PM 2nd Monday in month | — | aberto | https://rut.u3asite.uk/u3a_groups/richmond-cycling-group/ |
| 37 | Cycling: Easy Riders | Sport | Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/cycling-easy-riders/ |
| 38 | Darts | Sport | Weekly on Friday afternoons 2:00 PM-4:00 PM Vacancies | The Twickenham Club | aberto | https://rut.u3asite.uk/u3a_groups/darts/ |
| 39 | Democracy and its Discontent | History | Monthly on Wednesday afternoons 2:30 PM-4:30 PM 2nd Wednesday in month | Richmond | aberto | https://rut.u3asite.uk/u3a_groups/democracy-and-its-discontent/ |
| 40 | Dog Walking | Social, Walking | Monthly on Wednesday mornings 11:00 AM | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/dog-walking-meeting/ |
| 41 | Drama Group The 3rd Act | Drama | Weekly on Wednesday afternoons 2:00 PM-4:00 PM | ETNA | aberto | https://rut.u3asite.uk/u3a_groups/rut-drama-group/ |
| 42 | Finding meaning in later years | Philosophy | Weekly on Tuesday mornings 11:15 AM-1:15 PM The group will run for 8 weeks once a year from October to December. Precise dates, times & venue to be announced in July each year. | Crossway Centre, St Stephen’s Church | lista de espera | https://rut.u3asite.uk/u3a_groups/finding-meaning-in-later-years/ |
| 43 | French - Talking French 1 | Languages - FRENCH | Monthly on Tuesday mornings 10:15 AM-11:45 AM 3rd Tuesday in month | Richmond | lista de espera | https://rut.u3asite.uk/u3a_groups/french-talking-french-1/ |
| 44 | French - Talking French 2 | Languages - FRENCH | Monthly on Tuesday mornings 10:15 AM-11:45 AM 4th Tuesday in month | Richmond | aberto | https://rut.u3asite.uk/u3a_groups/french-talking-french-2/ |
| 45 | French -Intermed Conversation1 | Languages - FRENCH | Weekly on Wednesday mornings 10:00 AM-12:00 PM Waiting list | Sheen | fechado | https://rut.u3asite.uk/u3a_groups/french-intermediate-conversation-1/ |
| 46 | French -Intermed Conversation2 | Languages - FRENCH | Fortnightly on Friday mornings 10:30 AM-12:00 PM Waiting list | Park Hotel Teddington | lista de espera | https://rut.u3asite.uk/u3a_groups/french-intermediate-conversation-2/ |
| 47 | French Advanced 1 | Languages - FRENCH | Weekly on Tuesday afternoons 4:00 PM-5:00 PM | East Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/french-advanced-1/ |
| 48 | French Advanced 2 | Languages - FRENCH | Weekly on Wednesday afternoons 3:00 PM-4:30 PM Waiting list | Twickenham | lista de espera | https://rut.u3asite.uk/u3a_groups/french-advanced/ |
| 49 | French Advanced 3 | Languages - FRENCH | Weekly on Friday afternoons 4:00 PM-5:00 PM | East Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/french-advanced-3/ |
| 50 | French Book Group (modern) | Languages - FRENCH | Monthly on Tuesday mornings 10:30 AM-12:00 PM 3rd Tuesday in month | Teddington | lista de espera | https://rut.u3asite.uk/u3a_groups/french-literature-book-group-modern/ |
| 51 | French for Improvers | Languages - FRENCH | On Fridays 2:00 PM-3:00 PM Vacancies | Kew | aberto | https://rut.u3asite.uk/u3a_groups/french-for-improvers/ |
| 52 | Garden Enthusiasts | Gardens | Monthly on Monday mornings 10:30 AM-12:30 PM 1st Monday in month | Various locations | lista de espera | https://rut.u3asite.uk/u3a_groups/garden-enthusiasts/ |
| 53 | Gardening Fans | Gardens | Monthly on Thursday afternoons 2:00 PM-4:00 PM 2nd Thursday in month | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/gardening-fans/ |
| 54 | German Intermediate | Languages - GERMAN | Fortnightly on Friday afternoons 2:00 PM-4:00 PM Waiting list | Strawberry Hill | aberto | https://rut.u3asite.uk/u3a_groups/german-intermediate/ |
| 55 | German Intermediate/Advanced | Languages - GERMAN | On Wednesday afternoons 12:00 PM-2:00 PM Fortnightly | Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/german-intermediate-advanced/ |
| 56 | Greek Classical (Ancient) | Languages - OTHER | Fortnightly on Monday afternoons 2:00 PM-4:00 PM Vacancies | Hanworth | aberto | https://rut.u3asite.uk/u3a_groups/greek-classical-ancient/ |
| 57 | History - British and European | History | Fortnightly on Tuesday afternoons 2:00 PM-3:30 PM no vacancies at present | (casa de membro — excluído) | lista de espera | https://rut.u3asite.uk/u3a_groups/history-british-and-european/ |
| 58 | History - Pivotal | History | Fortnightly on Wednesday afternoons 2:30 PM-4:30 PM Waiting list | Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/history-pivotal-2/ |
| 59 | History Behind the Headlines 1 | History | Monthly on Monday afternoons 2:30 PM-4:30 PM 1st Monday | Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/history-behind-the-headlines-1/ |
| 60 | History Behind the Headlines 2 | History | Monthly on Thursday mornings 10:30 AM-12:00 PM 3rd Thursday in month | Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/history-behind-the-headlines-2/ |
| 61 | IT Help | IT | Monthly on Saturday afternoons 2:00 PM-3:30 PM 1st Saturday in month | ETNA | aberto | https://rut.u3asite.uk/u3a_groups/it-and-tech-help/ |
| 62 | IT Support | IT | Afternoons Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/it-support/ |
| 63 | Italian - Improvers | Languages - ITALIAN | Weekly on Thursday mornings 10:30 AM-11:30 AM Waiting list | Richmond | lista de espera | https://rut.u3asite.uk/u3a_groups/italian-improvers/ |
| 64 | Italian - Intermediate | Languages - ITALIAN | Fortnightly on Wednesday mornings 10:30 AM-12:30 PM Waiting list | Various locations | lista de espera | https://rut.u3asite.uk/u3a_groups/italian-intermediate-3/ |
| 65 | Italian - Talking Italian | Languages - ITALIAN | Weekly on Wednesday mornings 10:30 AM-12:00 PM Waiting list | Richmond | aberto | https://rut.u3asite.uk/u3a_groups/italian-talking-italian/ |
| 66 | Italian Advanced | Languages - ITALIAN | Fortnightly on Tuesday afternoons 2:00 PM-4:00 PM Vacancies | The Old Ship | aberto | https://rut.u3asite.uk/u3a_groups/italian-advanced/ |
| 67 | Italian for Pleasure | Languages - ITALIAN | Fortnightly on Tuesday mornings 10:00 AM-12:00 PM Waiting list | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/italian-for-pleasure/ |
| 68 | Italian Intermediate 2 | Languages - ITALIAN | Fortnightly on Wednesday afternoons 2:15 PM-4:15 PM | East Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/italian-intermediate-2-2/ |
| 69 | Italian-Conversation Intermediate | Languages - ITALIAN | Fortnightly on Thursday mornings 10:30 AM-12:00 PM Vacancies | Various locations | fechado | https://rut.u3asite.uk/u3a_groups/italian-conversation-intermediate/ |
| 70 | Kew Gardens | Gardens | Fortnightly on Thursday mornings 10:30 AM Vacancies | Kew | aberto | https://rut.u3asite.uk/u3a_groups/kew-gardens/ |
| 71 | Knit and Natter | Social | Fortnightly on Tuesday afternoons 1:30 PM-3:00 PM Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/knit-and-natter/ |
| 72 | Knitting, Crochet and Chat | Social | Fortnightly on Monday mornings 10:00 AM-12:00 PM Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/knitting-crochet-and-chat/ |
| 73 | Latin Literature 1 | Languages - OTHER | Fortnightly on Wednesday mornings 10:30 AM-12:30 PM Waiting list | (casa de membro — excluído) | aberto | https://rut.u3asite.uk/u3a_groups/latin-literature/ |
| 74 | Latin Literature 2 | Languages - OTHER | Fortnightly on Wednesday afternoons 2:00 PM-4:00 PM | (casa de membro — excluído) | aberto | https://rut.u3asite.uk/u3a_groups/latin-literature-2/ |
| 75 | Law and Justice | Politics & Law | Monthly on Monday afternoons 2:30 PM-4:30 PM 2nd Monday of the month | Twickenham | lista de espera | https://rut.u3asite.uk/u3a_groups/simply-social-twickenham/ |
| 76 | Lawn Bowls | Sport | Weekly on Friday afternoons 2:00 PM-4:00 PM | Hampton Bowls Club | aberto | https://rut.u3asite.uk/u3a_groups/lawn-bowls/ |
| 77 | London Explorers | Walking | Monthly Vacancies | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/london-explorers/ |
| 78 | Mahjong | Social | On Friday afternoons 2:00 PM-4:00 PM Waiting list | ETNA | lista de espera | https://rut.u3asite.uk/u3a_groups/mahjong/ |
| 79 | Mathematical Topics | Maths | Fortnightly on Friday afternoons 2:30 PM-4:30 PM Vacancies | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/mathematical-topics-1/ |
| 80 | Mindfulness in Nature | Section: Recreation | On Monday mornings 10:15 AM | Bushy Park | aberto | https://rut.u3asite.uk/u3a_groups/mindfulness-in-nature/ |
| 81 | Nordic Walking | Walking | Weekly on Thursday mornings 10:00 AM-11:00 AM Waiting List | Bushy Park | aberto | https://rut.u3asite.uk/u3a_groups/nordic-walking/ |
| 82 | Nordic Walking - gentle pace | Section: Recreation | Weekly on Thursday mornings 10:00 AM-11:00 AM | Bushy Park | aberto | https://rut.u3asite.uk/u3a_groups/nordic-walking-gentle-pace/ |
| 83 | Opera for Pleasure 1 | Music | Monthly on Monday afternoons 2:00 PM-5:00 PM 1st Monday in month | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/opera-for-pleasure-1/ |
| 84 | Opera for Pleasure 2 | Music | Monthly on Thursday afternoons 2:00 PM-5:00 PM 2nd Thursday in month | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/opera-for-pleasure-2/ |
| 85 | Petanque 1 |  | Afternoons Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/petanque-1/ |
| 86 | Petanque 2 | Section: Recreation | Weekly mornings 10:30 AM-12:30 PM Vacancies | Palewell Park | aberto | https://rut.u3asite.uk/u3a_groups/petanque-2/ |
| 87 | Philosophy-Thoughts & Opinions | Politics & Law | Fortnightly on Tuesday mornings 10:30 AM-12:30 PM Vacancies | ETNA | aberto | https://rut.u3asite.uk/u3a_groups/politics-thoughts-and-opinions/ |
| 88 | Photography |  | On Friday afternoons Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/photography/ |
| 89 | Pickleball | Sport | Weekly on Saturdays 12:00 PM-1:00 PM | St Mary's University | aberto | https://rut.u3asite.uk/u3a_groups/pickleball/ |
| 90 | Play Reading | Drama | Monthly on Monday afternoons 2:00 PM-4:30 PM 2nd Monday in month | Teddington | fechado | https://rut.u3asite.uk/u3a_groups/play-reading/ |
| 91 | Poetry - since 1900 | Literature | Monthly on Tuesday afternoons 2:30 PM-4:30 PM 1st Tuesday in month | Whitton | aberto | https://rut.u3asite.uk/u3a_groups/poetry-since-1900/ |
| 92 | Poetry Appreciation | Literature | Monthly on Wednesday afternoons 2:00 PM-3:00 PM Vacancies | Chiswick | aberto | https://rut.u3asite.uk/u3a_groups/poetry-appreciation/ |
| 93 | Poetry for Pleasure | Literature | Monthly on Tuesday afternoons 2:00 PM-4:00 PM Waiting list | The Duke’s Head | aberto | https://rut.u3asite.uk/u3a_groups/poetry-for-pleasure/ |
| 94 | Politics | Politics & Law | On Tuesday mornings 11:00 AM-1:00 PM | Kew Green | lista de espera | https://rut.u3asite.uk/u3a_groups/politics/ |
| 95 | Politics and Current Affairs 1 | Politics & Law | Fortnightly on Tuesday mornings 10:30 AM-12:30 PM | ETNA | lista de espera | https://rut.u3asite.uk/u3a_groups/politics-and-current-affairs-1/ |
| 96 | Politics and Current Affairs 2 | Politics & Law | On Monday afternoons Waiting list | — | aberto | https://rut.u3asite.uk/u3a_groups/politics-and-current-affairs-2/ |
| 97 | Pub Lunches | Social | Monthly on Wednesdays 12:00 PM | — | aberto | https://rut.u3asite.uk/u3a_groups/pub-lunches/ |
| 98 | Railway Journeys | Social | Monthly | — | lista de espera | https://rut.u3asite.uk/u3a_groups/railway-journeys/ |
| 99 | Rambling - Capital Ring | Section: Recreation | Monthly on Thursdays 3rd Thursday | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/rambling-capital-ring/ |
| 100 | Rambling - London | Walking | Monthly on Thursday mornings 10:00 AM 2nd Thursday in month | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/rambling-london/ |
| 101 | Rambling - River Walks 1 | Walking | On Wednesday mornings Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/rambling-river-walks-1/ |
| 102 | Rambling - River Walks 2 | Walking | On Thursday mornings Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/rambling-river-walks-2/ |
| 103 | Rambling - Stroll & Chat | Section: Recreation | Fortnightly on Monday mornings | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/rambling-stroll-chat/ |
| 104 | Rambling-Gentle Walk+lunch | Walking | On Fridays Vacancies | — | aberto | https://rut.u3asite.uk/u3a_groups/rambling-gentle-walklunch/ |
| 105 | Rummikub | Social | Weekly on Wednesday mornings 10:30 AM-12:30 PM | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/rummicub/ |
| 106 | Rummikub Players | Section: Recreation | Weekly on Tuesday afternoons 2:00 PM-4:00 PM | Hampton Hill | lista de espera | https://rut.u3asite.uk/u3a_groups/rummikub-players/ |
| 107 | Science and Metaphysics | Section: Art, Languages, Music & Science | Fortnightly on Friday afternoons 2:30 PM-4:30 PM Vacancies | Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/science-and-metaphysics/ |
| 108 | Scrabble 1 | Social | Fortnightly on Monday afternoons | ETNA | aberto | https://rut.u3asite.uk/u3a_groups/scrabble-1/ |
| 109 | Scrabble 2 | Social | Fortnightly on Tuesday afternoons | (casa de membro — excluído) | lista de espera | https://rut.u3asite.uk/u3a_groups/scrabble-2/ |
| 110 | Scrabble 3 | Social | Fortnightly on Thursday afternoons 2:30 PM-4:30 PM Waiting list | (casa de membro — excluído) | lista de espera | https://rut.u3asite.uk/u3a_groups/scrabble-3/ |
| 111 | Seated Exercise | Social | Weekly on Thursday afternoons 12:30 PM-1:30 PM Waiting list | ETNA | lista de espera | https://rut.u3asite.uk/u3a_groups/extend-exercise/ |
| 112 | Shakespeare - Page and Stage | Literature | Fortnightly on Wednesday afternoons 2:30 PM-4:30 PM | Richmond | lista de espera | https://rut.u3asite.uk/u3a_groups/shakespeare-page-and-stage/ |
| 113 | Shakespeare for Pleasure | Literature | Fortnightly on Friday afternoons 2:30 PM-4:30 PM | Teddington | lista de espera | https://rut.u3asite.uk/u3a_groups/shakespeare-for-pleasure/ |
| 114 | Simply Social: Richmond 1 | Social | Monthly on Monday mornings 10:30 AM-12:00 PM 3rd Monday in month | Bill's Cafe | aberto | https://rut.u3asite.uk/u3a_groups/simply-social-richmond/ |
| 115 | Simply Social: Richmond 2 | Social | Monthly on Tuesday mornings 11:00 AM-12:30 PM 1st Tuesday | Bill's Cafe | aberto | https://rut.u3asite.uk/u3a_groups/simply-social-richmond-2/ |
| 116 | Simply Social: St Margarets | Social | Monthly on Tuesday afternoons 2:30 PM-4:30 PM 1st Tuesday | — | lista de espera | https://rut.u3asite.uk/u3a_groups/simply-social-st-margarets/ |
| 117 | Simply Social: Teddington | Social | Monthly on Tuesday afternoons 2:00 PM 3rd Tuesday of month | Park Hotel Teddington | aberto | https://rut.u3asite.uk/u3a_groups/simply-social-teddington/ |
| 118 | Singing for Pleasure | Music | Fortnightly on Thursday afternoons 2:15 PM-4:00 PM 1st and 3rd Thursday in month | Kew Green | aberto | https://rut.u3asite.uk/u3a_groups/singing-for-pleasure/ |
| 119 | Skiffle | Music | — | — | aberto | https://rut.u3asite.uk/u3a_groups/skiffle/ |
| 120 | Spanish Conversation | Languages - SPANISH | Weekly on Wednesday afternoons 3:00 PM-4:00 PM Vacancies | Google Meet (online) | aberto | https://rut.u3asite.uk/u3a_groups/spanish-conversation/ |
| 121 | Spanish Conversation Advanced | Languages - SPANISH | Weekly on Wednesday afternoons 3:30 PM-5:00 PM Waiting List | Twickenham | aberto | https://rut.u3asite.uk/u3a_groups/spanish-conversation-advanced/ |
| 122 | Spanish Conversation Intermed 1 | Languages - SPANISH | Weekly on Wednesday afternoons 2:00 PM-3:30 PM Waiting List | Twickenham | lista de espera | https://rut.u3asite.uk/u3a_groups/spanishconversation-intermed-1/ |
| 123 | Spanish Conversation Intermed 2 | Languages - SPANISH | Weekly on Tuesday mornings 10:00 AM-12:00 PM | The Anglers Pub | fechado | https://rut.u3asite.uk/u3a_groups/spanish-conversation-intermediate-2/ |
| 124 | Spanish Conversation Intermed 3 | Languages - SPANISH | Weekly on Wednesday mornings 10:30 AM-12:00 PM | Richmond | lista de espera | https://rut.u3asite.uk/u3a_groups/spanish-conversation-intermediate-3/ |
| 125 | Spanish Pre-Intermediate | Languages - SPANISH | Weekly on Wednesday mornings 10:30 AM-12:00 PM | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/spanish-pre-intermediate/ |
| 126 | Stamp and Postal History | History | On Monday mornings 11:00 AM-12:00 PM Vacancies | United Reform Church | aberto | https://rut.u3asite.uk/u3a_groups/stamp-and-postal-history/ |
| 127 | Sunday Lunch Group | Social | Monthly on Sundays | — | aberto | https://rut.u3asite.uk/u3a_groups/sunday-lunch-group/ |
| 128 | Swimming 1 | Section: Recreation | Weekly on Thursday mornings 11:00 AM | Richmond | aberto | https://rut.u3asite.uk/u3a_groups/swimming-1/ |
| 129 | Table Tennis 1 | Sport | Weekly on Thursday afternoons 1:45 PM-3:15 PM Waiting list | Whitton Community Centre | lista de espera | https://rut.u3asite.uk/u3a_groups/table-tennis-1/ |
| 130 | Table Tennis 2 | Sport | Weekly on Tuesday afternoons 2:45 PM-4:00 PM Vacancies | Whitton Community Centre | aberto | https://rut.u3asite.uk/u3a_groups/table-tennis-2/ |
| 131 | Table Tennis 3 | Sport | Weekly on Thursday afternoons 2:00 PM-4:00 PM Waiting list | Hampton Hill | lista de espera | https://rut.u3asite.uk/u3a_groups/table-tennis-3/ |
| 132 | Tap Dancing | Social | Weekly on Monday mornings 10:30 AM-11:30 AM Waiting List | Whitton Community Centre | lista de espera | https://rut.u3asite.uk/u3a_groups/tap-dancing/ |
| 133 | Tarot Share | Social | Monthly on Thursday mornings 10:30 AM-12:00 PM | Teddington | aberto | https://rut.u3asite.uk/u3a_groups/tarot-share/ |
| 134 | Theatre Matinees &#038; Drama | Drama | Average two/three matinees per month. | — | aberto | https://rut.u3asite.uk/u3a_groups/theatre-matinees-drama/ |
| 135 | Tomorrow's World | Science | Monthly on Monday afternoons 2:30 PM-4:30 PM 3rd Monday in month | ETNA | aberto | https://rut.u3asite.uk/u3a_groups/tomorrows-world/ |
| 136 | Travel Group | General | Monthly on Friday mornings -12:30 PM 2nd Fridays of month | — | aberto | https://rut.u3asite.uk/u3a_groups/travel-group/ |
| 137 | Ukulele 1 | Music | Weekly on Friday mornings 10:30 AM-11:30 AM Waiting list | Whitton | lista de espera | https://rut.u3asite.uk/u3a_groups/ukulele-1/ |
| 138 | Ukulele 2 | Music | Weekly on Wednesday mornings 10:30 AM-11:30 AM Waiting list | Putney | lista de espera | https://rut.u3asite.uk/u3a_groups/ukulele-2/ |
| 139 | Ukulele 3 | Music | Weekly on Wednesday mornings 10:30 AM-11:30 AM | Whitton | lista de espera | https://rut.u3asite.uk/u3a_groups/ukelele-3/ |
| 140 | Visiting the V&A | Art | Monthly on Saturday mornings 9:30 AM Third Saturday | — | aberto | https://rut.u3asite.uk/u3a_groups/visiting-the-va/ |
| 141 | Walking Netball | Sport | Weekly on Tuesday mornings 11:30 AM-12:30 PM Vacancies | Barnes | aberto | https://rut.u3asite.uk/u3a_groups/walking-netball/ |
| 142 | Wandsworth U3A - Putney Strollers | Walking | Monthly on Tuesday mornings 10:30 AM 1st Tuesday of month | — | aberto | https://rut.u3asite.uk/u3a_groups/wandsworth-u3a-putney-strollers/ |
| 143 | Weekenders | Section: Recreation | Weekly | Various locations | aberto | https://rut.u3asite.uk/u3a_groups/weekenders/ |
| 144 | Welcome Circle: coffee, chat and connection | Section: Recreation | Weekly on Friday mornings | Strawberry Hill House cafe | aberto | https://rut.u3asite.uk/u3a_groups/welcome-circle-coffee-chat-and-connection/ |
| 145 | Wine Tasting | Food & Wine | Monthly on Wednesday afternoons 12:30 PM-2:30 PM 2nd Wednesday in month | The Britannia | aberto | https://rut.u3asite.uk/u3a_groups/wine-tasting/ |
| 146 | Writing for Pleasure | Literature | Fortnightly on Tuesday afternoons 2:00 PM-4:15 PM | Twickenham | lista de espera | https://rut.u3asite.uk/u3a_groups/writing-for-pleasure/ |

### A3. Richmond u3a — locais (u3a_venue, 54)

| Local | Código postal | Observação | URL |
|---|---|---|---|
| All Hallows' Church | TW1 1DA |  | https://rut.u3asite.uk/u3a_venues/all-hallows-church/ |
| Barnes | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/barnes/ |
| Bill's Cafe | TW10 6UQ |  | https://rut.u3asite.uk/u3a_venues/bills-cafe/ |
| Bushy Park | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/bushy-park/ |
| Chiswick | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/chiswick/ |
| Clarendon Hall | TW1 3AA |  | https://rut.u3asite.uk/u3a_venues/clarendon-hall/ |
| Crossway Centre, St Stephen’s Church | TW1 2PD |  | https://rut.u3asite.uk/u3a_venues/crossway-centre-st-stephens-church/ |
| East Sheen | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/east-sheen/ |
| East Twickenham | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/east-twickenham/ |
| ETNA | TW1 2AR |  | https://rut.u3asite.uk/u3a_venues/etna/ |
| Google Meet | — | online — não é local físico | https://rut.u3asite.uk/u3a_venues/google-meet/ |
| Ham | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/ham/ |
| Hampton | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/hampton/ |
| Hampton Bowls Club | TW12 2LY |  | https://rut.u3asite.uk/u3a_venues/hampton-bowls-club/ |
| Hampton Hill | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/hampton-hill/ |
| Hanworth | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/hanworth-park/ |
| Kew | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/kew/ |
| Kew Green | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/kew-green/ |
| (privado) | — | privado — excluir | https://rut.u3asite.uk/u3a_venues/members-home/ |
| Orange Tree | TW9 2NQ |  | https://rut.u3asite.uk/u3a_venues/orange-tree/ |
| Orleans Park School | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/orleans-park-school/ |
| Palewell Park | SW14 8RF |  | https://rut.u3asite.uk/u3a_venues/palewell-park/ |
| Park Hotel Teddington | TW11 0AB |  | https://rut.u3asite.uk/u3a_venues/park-hotel-teddington/ |
| Petersham | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/petersham/ |
| Putney | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/putney/ |
| Richmond | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/richmond/ |
| Sheen | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/sheen/ |
| St Margarets | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/st-margarets/ |
| St Mary's Church | TW1 3NJ |  | https://rut.u3asite.uk/u3a_venues/st-marys-church/ |
| St Mary's University | TW11 9BE |  | https://rut.u3asite.uk/u3a_venues/st-marys-university/ |
| Strawberry Hill | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/strawberry-hill/ |
| Strawberry Hill House cafe | TW1 4ST |  | https://rut.u3asite.uk/u3a_venues/strawberry-hill-house-cafe/ |
| Teddington | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/teddington/ |
| The Anglers Pub | TW11 9NR |  | https://rut.u3asite.uk/u3a_venues/the-anglers-pub/ |
| The Britannia | TW9 1HH |  | https://rut.u3asite.uk/u3a_venues/the-britannia/ |
| The Castlebar | TW11 8HA |  | https://rut.u3asite.uk/u3a_venues/the-castlebar/ |
| The Crown | TW1 2NH |  | https://rut.u3asite.uk/u3a_venues/the-crown/ |
| The Duke’s Head | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/the-dukes-head/ |
| The Foresters Arms | KT1 4DG |  | https://rut.u3asite.uk/u3a_venues/the-foresters-arms/ |
| The King's Head | TW11 8HG |  | https://rut.u3asite.uk/u3a_venues/the-kings-head/ |
| The Mute Swan | KT8 9BN |  | https://rut.u3asite.uk/u3a_venues/the-mute-swan/ |
| The Old Ship | TW9 1ND |  | https://rut.u3asite.uk/u3a_venues/the-old-ship/ |
| The Prince Albert | TW2 5QB |  | https://rut.u3asite.uk/u3a_venues/the-prince-albert/ |
| The Red Cow | TW9 1YJ |  | https://rut.u3asite.uk/u3a_venues/the-red-cow/ |
| The Sun Inn | TW9 2RG |  | https://rut.u3asite.uk/u3a_venues/the-sun-inn/ |
| The Twickenham Club | TW1 3NJ |  | https://rut.u3asite.uk/u3a_venues/the-twickenham-club/ |
| The White Hart | KT1 4DA |  | https://rut.u3asite.uk/u3a_venues/the-white-hart/ |
| Twickenham | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/twickenham/ |
| United Reform Church | TW12 1NB |  | https://rut.u3asite.uk/u3a_venues/united-reform-church/ |
| Various locations | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/various-locations/ |
| Watermans Arts Centre | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/watermans/ |
| Whitton | — | só bairro / sem código postal — não geocodificável sem curadoria | https://rut.u3asite.uk/u3a_venues/whitton/ |
| Whitton Community Centre | TW2 6JL |  | https://rut.u3asite.uk/u3a_venues/whitton-community-centre/ |
| ZOOM | — | online — não é local físico | https://rut.u3asite.uk/u3a_venues/zoom/ |
