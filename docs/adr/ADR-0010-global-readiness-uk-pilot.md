# ADR-0010 — Global Readiness: UK Pilot (Decisão de Adiamento)

**Status:** Adiado (registado para fase futura)
**Data:** 2026-07-05
**Decisores:** Eduardo Menezes

---

## Contexto

A Vivere Engine é tecnicamente capaz de operar globalmente desde a sua concepção.
Regiões são configuração pura — latitude, longitude, raio e label — sem qualquer
lógica hardcoded que assuma Brasil ou língua portuguesa.

Foi colocada a questão de adicionar Richmond, London como região de teste para
validar o funcionamento em contexto UK.

---

## Decisão

**Não implementar agora.**

Manter foco total no Brasil / Região dos Lagos até consolidar:

- Admin Panel profissional
- Review workflow completo
- Entity Resolution Engine
- Publishing Layer (Caminho B)
- Integração com app Vivere 60+

---

## Justificação do adiamento

Embora o motor seja agnóstico de geografia, uma operação UK real exige uma
fase própria de validação porque muda mais do que apenas coordenadas:

| Dimensão | Brasil (actual) | UK (futuro) |
|---|---|---|
| Idioma das queries | Português | Inglês |
| Palavras-chave do Venue Filter | PT-BR | EN-GB |
| Categorias | danca_idosos, hidroginastica, teatro… | dance for seniors, swimming, theatre… |
| Fontes locais | Prefeituras | Council websites, Eventbrite UK |
| Regras culturais | Público 60+ RJ | Público 60+ London Borough |
| product_key | vivere-60-mais | vivere-60-plus-uk-test |

Avançar agora sem esta preparação produziria dados de baixa qualidade e
distrairia do objectivo principal do piloto Brasil.

---

## Roadmap registado — Future Phase: Global Readiness / UK Pilot

**Região inicial:** Richmond upon Thames, London, UK
**Coordenadas:** lat 51.4613, lng -0.3037, radius 8000m
**product_key provável:** `vivere-60-plus-uk-test`
**Execução inicial:** dry-run apenas (sem escrita no banco)
**Custo estimado:** ~USD 0.22 (7 categorias × 1 região × $0.032)

**O que precisa de ser preparado antes:**
1. Versão em inglês das queries de categoria
2. Versão em inglês das accept_keywords e review_keywords do Venue Filter
3. Validação de que os google_types retornados em UK são equivalentes aos do Brasil
4. Decisão sobre separação de schema (mesmo staging ou staging_uk?)
5. Avaliação de fontes locais (councils.gov.uk, Eventbrite UK, etc.)

**Pré-condição para iniciar esta fase:**
- Admin Panel operacional em produção
- Review workflow com Entity Resolution funcional
- Publishing Engine implementado
- Pelo menos 1 produto Brasil completamente validado com utilizadores reais

---

## O que isto confirma

A decisão de arquitectura de usar `product_key`, `source_region_label`,
coordenadas e queries como configuração — em vez de hardcoding — foi correcta.
Quando a fase UK chegar, o motor não precisará de alterações. Apenas:

1. Novo ficheiro de configuração de produto UK
2. Novas regras de Venue Filter em inglês
3. Novas sources (se aplicável)

Zero mudança no pipeline, repositórios, ou Review API.
