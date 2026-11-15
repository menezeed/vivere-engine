# Fontes de actividades: limitações conhecidas (Região dos Lagos, Rio de Janeiro, Niterói)

- **Data da sondagem:** 14/11/2026.
- **Âmbito:** só páginas e endpoints públicos: raiz, `robots.txt`, `/wp-json/wp/v2`, feeds e sitemaps.
  - User-Agent identificável e pausas entre pedidos.
  - Nada de scraping, de APIs pagas ou de base de dados.
- **Princípios deste documento:**
  1. **Prioridade a APIs públicas e fontes verificáveis.** Uma fonte só entra no registo (`src/collectors/wordpress-content/config/registry.ts`) se tiver API ou feed estruturado e se o `robots.txt` o permitir.
  2. **Não criar dados fictícios.** As fixtures de teste são sintéticas, marcadas como tal, e nunca são persistidas. Programação curada só vem de fonte oficial ou de parceiro identificado.
  3. **Não assumir datas sem evidência.** Uma data sem ano não é completada a partir da data de publicação. O item vai para revisão humana, com o motivo `structured_subevent_missing_date`. É o comportamento actual de `parseExplicitDatePt`, e este documento mantém-no.
  4. **Respeitar bloqueios.** Os portais com WAF ou `Disallow: /` não são contornados.

## Escala de viabilidade
- **A:** API ou feed estruturado, utilizável com o motor actual.
- **B:** possível, mas exige trabalho novo (outro collector, filtro por conteúdo, HTML) ou confirmação de termos.
- **C:** bloqueado ou inexistente. Não insistir.

## 1. Região dos Lagos

### Resumo por cidade
| Cidade | Fonte | Estado no registo | Viabilidade |
|---|---|---|---|
| Cabo Frio | WordPress, categoria Cultura (73) | activa | A |
| São Pedro da Aldeia | WordPress, categoria Eventos (49) | configurada; cobertura incompleta | A/B |
| Armação dos Búzios | WordPress, categoria Cultura e Patrimônio Histórico (1415) | configurada (PR #8) | A, com volume baixo |
| Rio das Ostras | WordPress, categoria Cultura (17) | configurada (PR #8) | A, com datas sem ano |
| Araruama | portal com CMS próprio, sem API | **fora do registo WordPress** (só Google Places) | C |

### Limitações por cidade

**Cabo Frio**
- A antiga categoria "Agenda Cultural" (1737) está abandonada desde 2023.
- Só a categoria Cultura (73) é usada.

**São Pedro da Aldeia**
- A categoria Eventos (49) teve **0 posts elegíveis** num dry-run real com janela de 30 dias.
- Há séries recorrentes publicadas ora em "Eventos", ora em "Uncategorized", por isso a categoria sozinha não garante cobertura.
- O conteúdo é sobretudo narrativo. Os blocos estruturados ("Serviço" + "Evento:/Data:/Horário:/Local:") existem, mas são raros.
- Algumas datas dos blocos estruturados não têm ano ("Data: 8 de novembro"). Vão para revisão; não se deduz o ano.
- **A melhorar:** uma estratégia de selecção por conteúdo, para além da categoria. Ainda não está aprovada.

**Armação dos Búzios**
- Tem 2–3 posts por mês, com muito ruído: editais, reuniões e notas institucionais.
- O conteúdo é narrativo (parágrafos Gutenberg), sem bloco "Serviço".
- A categoria "Eventos" (41) está praticamente parada desde 2025.
- O seu valor está em eventos pontuais.

**Rio das Ostras**
- Publica 1–2 posts por semana, muitos com o bloco "SERVIÇO" (Local, Endereço, Data, Horário, Ingresso).
- **As datas dos blocos costumam vir sem ano** ("Data: Domingo, 8 de novembro"). Por isso, a maioria dos itens estruturados vai para revisão.
- Há duas categorias "Cultura" (17 e 153) e uma "Eventos" (25). O config só suporta uma `category_id`, por isso a cobertura das três exige multi-categoria ou várias instâncias com deduplicação.
- O `robots.txt` responde 404, logo sem restrição declarada. Mantém-se a pausa de 300 ms entre páginas.

**Araruama**
- O portal não é WordPress: `/wp-json` devolve HTML, e `/feed` e `/rss` não existem.
- As notícias só existem em HTML paginado.
- O `ARARUAMA_CONFIG` é um **placeholder** (`category_id: 0`) e não está no registo.
- Opções, a decidir pelo PO:
  - collector HTML, depois de rever os termos do portal;
  - pedido de dados à prefeitura;
  - manter a cidade só com Google Places.

### Nada disto foi executado contra a fonte
Os configs de Búzios e Rio das Ostras foram validados com fixtures sintéticas que imitam a estrutura real. Antes de persistir no staging, é preciso:
- um dry-run real com autorização;
- revisão humana de uma amostra.

## 2. Rio de Janeiro (capital)
| Fonte | Situação | Viabilidade |
|---|---|---|
| Portal da Prefeitura e Secretaria de Cultura | WAF recusa pedidos automatizados, incluindo o `robots.txt` | C: só com contacto institucional, dados abertos ou API oficial |
| CRAS e centros de convivência | dentro do portal com WAF | C por via automática; B como lista curada de fonte oficial |
| Sesc RJ | WordPress com a REST **bloqueada (403)**; o RSS vem vazio; os sitemaps de programação e aulas estão actualizados | B: só por HTML a partir do sitemap; rever os termos e, de preferência, pedir acesso ou parceria |
| UnATI/UERJ | não é WordPress; o formato provável são páginas e PDFs por semestre | B: contacto directo |
| Turismo / Theatro Municipal | redirect não seguido / timeout | B: repetir e rever manualmente |

**Conclusão:** não há nenhuma fonte A na capital. Para a cobrir é preciso uma parceria ou programação curada a partir de fonte oficial.

## 3. Niterói
| Fonte | Situação | Viabilidade |
|---|---|---|
| Portal da Prefeitura | WordPress REST activo, vários posts por dia | B |
| Categorias Cultura, Idoso e Eventos | volume residual ou paradas | C |
| Programa 60UP (núcleos para 60+) | sem portal próprio identificado | B: lista dos núcleos e horários por contacto ou página oficial |
| Cultura de Niterói (agenda digital) | **`robots.txt`: `Disallow: /`** | C: só com pedido formal ou dados abertos |

**Notas sobre o portal da Prefeitura:**
- Quase tudo está numa categoria genérica, por isso a fonte exige um filtro por conteúdo.
- É instável: 2 de cerca de 8 pedidos falharam com erro de base de dados.
- Exige retries com backoff e baixa frequência.

## 4. Implicações para o motor
1. **Datas sem ano:** continuam a ir para revisão. Inferir o ano só será possível com regra aprovada e evidência no próprio texto (por exemplo, dia da semana coerente com um único ano candidato). Nunca apenas com a data de publicação.
2. **Multi-categoria** (Rio das Ostras) e **filtro por conteúdo** (São Pedro, Niterói): são evoluções do collector WordPress, com testes antes de qualquer activação.
3. **Collectors HTML** (Araruama, Sesc RJ): fora do motor actual. Só avançam com decisão do PO e revisão dos termos de uso.
4. **Programação curada** (CRAS, 60UP, UnATI, centros de convivência): precisa de um formato próprio com origem obrigatória (URL oficial ou parceiro) e data de verificação. Nada inventado, nada sem fonte.

## 5. Não verificado
- Termos de uso detalhados de cada portal.
- O destino do redirect de turismo do Rio.
- O Theatro Municipal (timeout).
- As datas da categoria Cultura de Niterói (erro do servidor).
