# Data Model

## Camada A
RawActivityItem / RawVenueItem
- Append-only
- Nunca sofre UPDATE
- Nunca sofre DELETE

## Camada B
Staging
- activities_staging
- venues_staging
- propostas aguardando revisão

## Camada C
Produção
- Dados publicados
- Integração futura com o schema operacional do aplicativo

## Proveniência
Todo dado deve informar:
- origem
- collector
- source
- confidence
- data da coleta
- decisão de publicação
