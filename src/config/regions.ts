/**
 * Registo declarativo de regiões (cidades) — L3/E2.
 *
 * Substitui as regiões codificadas à mão em pilotRegion.ts (duas
 * entradas fixas + um ternário para o rótulo). Cada cidade é UMA
 * entrada neste array: centro, raio, rótulo usado nas queries e as
 * fontes (source_key) que a cobrem. Nenhum código deve ramificar pelo
 * nome de uma cidade — tudo o que varia por cidade vive aqui.
 *
 * Adicionar uma cidade = acrescentar uma entrada a REGIONS + um teste
 * em src/config/__tests__/regions.test.ts. validateRegions() é
 * executado pelos testes e falha ruidosamente com chaves duplicadas,
 * coordenadas fora do intervalo, raio inválido ou rótulo vazio.
 *
 * A configuração Google Places do Vivere 60+
 * (src/collectors/google-places/config/vivere-60-mais.ts) também lê as
 * suas regiões daqui, por chave (regressão: snapshot das 56 queries).
 * Por isso city_label tem de ser preservado EXACTAMENTE (é o texto da
 * query e o display_label do gate geográfico), incluindo grafias
 * históricas como "Santo Amaro, Sao Paulo".
 *
 * NOTA SOBRE COORDENADAS: os centróides de Cabo Frio e Araruama são
 * aproximações do centro urbano (valores herdados de pilotRegion.ts,
 * sem alteração). Novas entradas devem usar coordenadas confirmadas
 * num mapa, não estimadas.
 */

export interface RegionDefinition {
  /** Identificador estável (snake_case) — usado em logs e como region_key das queries */
  key: string;
  /** Rótulo usado no texto das queries (ex: "Cabo Frio RJ") */
  city_label: string;
  /** Nome da cidade como aparece em region_metadata.city das fontes */
  city: string;
  /** UF (BR) ou subdivisão equivalente (ex: "London" no GB) */
  state: string;
  /**
   * Piloto UK (U1, 26/11/2026) — localização da região. Opcionais e
   * aditivos: ausentes = Brasil (DEFAULT_REGION_LOCALE), por isso as
   * regiões existentes não mudam. Ler sempre via regionLocale().
   */
  country?: string;   // ISO 3166-1 alpha-2, ex: 'GB'
  locale?: string;    // BCP 47, ex: 'en-GB'
  timezone?: string;  // IANA, ex: 'Europe/London'
  /**
   * Centro e raio. `null` (ambos) = ainda SEM centro confirmado num mapa:
   * a região só serve fontes de conteúdo (WordPress) e não pode ser usada
   * em pesquisas geográficas (Google Places) — requireGeo() falha.
   * Nunca inventar coordenadas para preencher estes campos.
   */
  center: { lat: number; lng: number } | null;
  radius_m: number | null;
  /**
   * source_key das fontes que cobrem esta cidade (ex: 'google_places',
   * 'prefeitura_cabo_frio'). Fontes WordPress têm de existir no registo
   * src/collectors/wordpress-content/config/registry.ts (verificado em teste).
   */
  sources: readonly string[];
}

export const GOOGLE_PLACES_SOURCE_KEY = 'google_places';

/**
 * Fontes de actividades que NÃO são WordPress de prefeitura nem Google
 * Places — têm script próprio (ex: scripts/ingest-u3a.ts) e são recusadas,
 * com motivo, pela ingestão por região (runRegionIngestion).
 */
export const U3A_RICHMOND_SOURCE_KEY = 'u3a_richmond';
export const NON_WORDPRESS_ACTIVITY_SOURCE_KEYS: ReadonlySet<string> = new Set([U3A_RICHMOND_SOURCE_KEY]);

export interface RegionLocale {
  country: string;
  locale: string;
  timezone: string;
}

/** Localização por omissão: todas as regiões anteriores ao piloto UK são do Brasil. */
export const DEFAULT_REGION_LOCALE: RegionLocale = {
  country: 'BR',
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
};

export function regionLocale(region: RegionDefinition): RegionLocale {
  return {
    country: region.country ?? DEFAULT_REGION_LOCALE.country,
    locale: region.locale ?? DEFAULT_REGION_LOCALE.locale,
    timezone: region.timezone ?? DEFAULT_REGION_LOCALE.timezone,
  };
}

export const REGIONS: readonly RegionDefinition[] = [
  {
    key: 'cabo_frio',
    city_label: 'Cabo Frio RJ',
    city: 'Cabo Frio',
    state: 'RJ',
    center: { lat: -22.8894, lng: -42.0188 },
    radius_m: 12000,
    sources: [GOOGLE_PLACES_SOURCE_KEY, 'prefeitura_cabo_frio'],
  },
  {
    key: 'araruama',
    city_label: 'Araruama RJ',
    city: 'Araruama',
    state: 'RJ',
    center: { lat: -22.8717, lng: -42.3433 },
    radius_m: 12000,
    // O portal municipal não é WordPress (sem /wp-json nem RSS — mapa de
    // fontes L1, 14/11/2026); só Google Places por agora.
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
  // Regional Baseline da Fase 9 (ADR-0021) — piloto de expansão regional.
  // Centro técnico: Av. Padre Antônio José dos Santos, Brooklin, São Paulo.
  // Coordenadas confirmadas directamente no Google Maps (não estimadas).
  // radius_m = 2500 é a decisão inicial; após o primeiro dry-run, avaliar:
  // quantidade de venues, sobreposição excessiva com Moema/Campo Belo/
  // Vila Olímpia/Berrini, cobertura efectiva do Brooklin, e custo estimado.
  // Reduzir o raio se houver muita sobreposição; aumentar se a cobertura
  // ficar insuficiente — ajuste de configuração, sem tocar arquitectura.
  {
    key: 'sp_brooklin_pilot',
    city_label: 'Brooklin, São Paulo',
    city: 'São Paulo',
    state: 'SP',
    center: { lat: -23.610110, lng: -46.686907 },
    radius_m: 2500,
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
  // 2ª onda da Regional Expansion (ADR-0021) — Campo Belo.
  // Centro técnico: Praça Pereira Coutinho, Campo Belo, São Paulo.
  // Coordenadas confirmadas directamente no Google Maps (não estimadas).
  // Definição operacional completa, incluindo candidatos descartados,
  // em docs/regional-baselines/campo-belo-definicao-operacional.md.
  // radius_m = 2500, mesmo critério do Brooklin — sem razão objectiva
  // para alterar nesta fase. Hipótese principal desta onda: validar o
  // comportamento do modelo de Regional Baselines quando duas regiões
  // vizinhas partilham naturalmente parte do mesmo ecossistema urbano
  // (ver docs/regional-baselines/campo-belo-planning.md).
  {
    key: 'campo_belo',
    city_label: 'Campo Belo, São Paulo',
    city: 'São Paulo',
    state: 'SP',
    center: { lat: -23.593029, lng: -46.669480 },
    radius_m: 2500,
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
  // Expansão do mercado Região dos Lagos (RJ) — completar cobertura
  // ao lado de Cabo Frio e Araruama, já reprocessadas com a Engine
  // actual (ver regional-baseline-report / snapshots correspondentes).
  // Coordenadas confirmadas directamente no Google Maps (não estimadas).
  // radius_m = 4000, deliberadamente conservador — cidade
  // significativamente menor que Cabo Frio/Araruama; evita
  // sobreposição forte com o raio de 12km de Cabo Frio, que fica
  // geograficamente próxima. Ajuste futuro (se necessário) baseado em
  // evidência do dry-run, não em suposição — mesma disciplina já
  // aplicada em Campo Belo. Definição operacional completa em
  // docs/regional-baselines/sao-pedro-da-aldeia-definicao-operacional.md.
  {
    key: 'sao_pedro_da_aldeia',
    city_label: 'São Pedro da Aldeia RJ',
    city: 'São Pedro da Aldeia',
    state: 'RJ',
    center: { lat: -22.835174, lng: -42.098698 },
    radius_m: 4000,
    sources: [GOOGLE_PLACES_SOURCE_KEY, 'prefeitura_sao_pedro_da_aldeia'],
  },
  // Mesma onda de expansão do mercado Região dos Lagos, mesmo critério
  // de raio conservador de São Pedro da Aldeia. Definição operacional
  // completa em docs/regional-baselines/iguaba-grande-definicao-operacional.md.
  {
    key: 'iguaba_grande',
    city_label: 'Iguaba Grande RJ',
    city: 'Iguaba Grande',
    state: 'RJ',
    center: { lat: -22.839561, lng: -42.220774 },
    radius_m: 4000,
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
  // 3ª Regional Baseline da Região Metropolitana de SP (ADR-0021) —
  // Moema. Centro técnico: Praça Nossa Senhora Aparecida / Estação
  // Moema, no encontro da Av. Ibirapuera, Av. Moema e Av. Divino
  // Salvador. Coordenadas confirmadas directamente no Google Maps
  // (não estimadas). Definição operacional completa, incluindo
  // candidatos descartados (Parque Ibirapuera, Shopping Ibirapuera,
  // Aeroporto de Congonhas), em
  // docs/regional-baselines/moema-definicao-operacional.md.
  // radius_m = 2500, igual ao Brooklin e Campo Belo — deliberado,
  // para preservar comparabilidade directa entre Regional Baselines
  // em vez de optimizar cada raio isoladamente. Hipótese principal
  // desta onda: validar se o modelo de Regional Baselines continua
  // correcto quando TRÊS regiões vizinhas (Brooklin, Campo Belo,
  // Moema) partilham o mesmo ecossistema urbano — ver
  // docs/regional-baselines/moema-planning.md.
  {
    key: 'moema',
    city_label: 'Moema, São Paulo',
    city: 'São Paulo',
    state: 'SP',
    center: { lat: -23.60361, lng: -46.66194 },
    radius_m: 2500,
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
  {
    key: 'santo_amaro',
    // Grafia sem acento preservada: é o texto das queries já executadas.
    city_label: 'Santo Amaro, Sao Paulo',
    city: 'São Paulo',
    state: 'SP',
    center: { lat: -23.65171, lng: -46.70693 },
    radius_m: 2500,
    sources: [GOOGLE_PLACES_SOURCE_KEY],
  },
  // E5 — cidades da Região dos Lagos com fonte WordPress confirmada no L1
  // (14/11/2026), mas SEM centro confirmado num mapa: center/radius_m
  // ficam null (nada inventado). Servem só a ingestão de conteúdo
  // (scripts/ingest-region.ts); Google Places exige confirmar o centro.
  {
    key: 'buzios',
    city_label: 'Armação dos Búzios RJ',
    city: 'Armação dos Búzios',
    state: 'RJ',
    center: null,
    radius_m: null,
    sources: ['prefeitura_buzios'],
  },
  {
    key: 'rio_das_ostras',
    city_label: 'Rio das Ostras RJ',
    city: 'Rio das Ostras',
    state: 'RJ',
    center: null,
    radius_m: null,
    sources: ['prefeitura_rio_das_ostras'],
  },
  // Piloto UK (U1, 26/11/2026; ADR-0010) — SÓ STAGING, produto
  // vivere-60-plus-uk-test. Centro do ADR-0010 (51.4613, -0.3037), o mesmo
  // centro do mapa oficial da Visit Richmond. Raio 8 km (ADR-0010).
  // Publicação bloqueada para produtos não-BR até U8 (fuso por região).
  {
    key: 'richmond_upon_thames',
    city_label: 'Richmond upon Thames, London',
    city: 'Richmond upon Thames',
    state: 'London',
    country: 'GB',
    locale: 'en-GB',
    timezone: 'Europe/London',
    center: { lat: 51.4613, lng: -0.3037 },
    radius_m: 8000,
    sources: [U3A_RICHMOND_SOURCE_KEY],
  },
];

/**
 * Centro e raio de uma região, exigidos por qualquer uso geográfico
 * (Google Places, gate geográfico). Falha explicitamente para regiões
 * sem centro confirmado.
 */
export function requireGeo(region: RegionDefinition): { center: { lat: number; lng: number }; radius_m: number } {
  if (region.center === null || region.radius_m === null) {
    throw new Error(`regions.ts: região "${region.key}" não tem centro confirmado — não pode ser usada em pesquisas geográficas`);
  }
  return { center: region.center, radius_m: region.radius_m };
}

/**
 * Validação estrutural de um registo de regiões. Função pura — os
 * testes aplicam-na ao registo real e a registos sintéticos.
 */
export function validateRegions(regions: readonly RegionDefinition[]): void {
  const seen = new Set<string>();
  for (const r of regions) {
    if (!/^[a-z][a-z0-9_]*$/.test(r.key)) {
      throw new Error(`regions.ts: key inválida "${r.key}" (esperado snake_case)`);
    }
    if (seen.has(r.key)) {
      throw new Error(`regions.ts: key duplicada "${r.key}"`);
    }
    seen.add(r.key);
    if (r.city_label.trim() === '' || r.city.trim() === '' || r.state.trim() === '') {
      throw new Error(`regions.ts: "${r.key}" tem city_label, city ou state vazio`);
    }
    if ((r.center === null) !== (r.radius_m === null)) {
      throw new Error(`regions.ts: "${r.key}" tem center e radius_m inconsistentes (ambos ou nenhum)`);
    }
    if (r.center === null) {
      if (r.sources.includes(GOOGLE_PLACES_SOURCE_KEY)) {
        throw new Error(`regions.ts: "${r.key}" usa ${GOOGLE_PLACES_SOURCE_KEY} sem centro confirmado`);
      }
    } else {
      const { lat, lng } = r.center;
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error(`regions.ts: "${r.key}" tem coordenadas fora do intervalo`);
      }
      if (!Number.isInteger(r.radius_m) || r.radius_m! <= 0 || r.radius_m! > 50000) {
        throw new Error(`regions.ts: "${r.key}" tem radius_m inválido (${r.radius_m})`);
      }
    }
    if (new Set(r.sources).size !== r.sources.length) {
      throw new Error(`regions.ts: "${r.key}" tem sources duplicadas`);
    }
    if (r.country !== undefined && !/^[A-Z]{2}$/.test(r.country)) {
      throw new Error(`regions.ts: "${r.key}" tem country inválido (esperado ISO 3166-1 alpha-2)`);
    }
    if (r.locale !== undefined && !/^[a-z]{2}-[A-Z]{2}$/.test(r.locale)) {
      throw new Error(`regions.ts: "${r.key}" tem locale inválido (esperado ex: en-GB)`);
    }
    if (r.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: r.timezone });
      } catch {
        throw new Error(`regions.ts: "${r.key}" tem timezone IANA inválido (${r.timezone})`);
      }
    }
  }
}

export function getRegion(
  key: string,
  regions: readonly RegionDefinition[] = REGIONS,
): RegionDefinition {
  const region = regions.find((r) => r.key === key);
  if (!region) {
    throw new Error(`regions.ts: região "${key}" não existe no registo`);
  }
  return region;
}
