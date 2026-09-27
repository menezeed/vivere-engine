/**
 * src/publishing/__tests__/PublicationTransformer.test.ts
 * Sprint 8.3/8.7 — testes do componente puro. Zero Supabase, zero rede, zero relógio real.
 *
 * CORRECÇÃO (Level 3, 2026-09-23) — Stable Source Activity Identity.
 * makeActivity() ganhou sourceItemId (campo novo, obrigatório em
 * PublishableActivity). engine_activity_id deixou de ser igual a
 * activity.stagingId — passa a ser deriveEngineActivityId(sourceKey,
 * sourceItemId), determinístico. O valor esperado abaixo
 * ('7235d91b-a8d5-52fe-8645-4b6b41e09f43') é o mesmo golden vector de
 * activityIdentity.test.ts, para sourceKey='prefeitura_cabo_frio' +
 * sourceItemId='146007_0' — mantido consistente entre os dois arquivos de
 * teste deliberadamente.
 *
 * Activity 9/26, 2026-09-27 — makeActivity() ganhou recurrenceType/
 * recurrenceDays/recurrenceTime (campos novos, obrigatórios em
 * PublishableActivity — default null, evento único). ADR-0018 revisto:
 * recurrence_type/recurrence_days/recurrence_time SAÍRAM da lista de
 * campos preservados/nunca-escritos — testes de whitelist actualizados
 * (16 campos, não mais 13). Testes novos de recorrência no final do
 * arquivo (describe 'PublicationTransformer.transformActivity — Activity
 * 9/26 Recurrence').
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublicationTransformer } from '../services/PublicationTransformer.js';
import type {
  PublishableVenue,
  PublishableActivity,
  ActivityOccurrence,
  StagingVenueId,
  StagingActivityId,
  PublicVenueId,
} from '../types/domain.js';

// ── Fixtures ──────────────────────────────────────────────────────────

const S_VENUE_ID = 'sv-001' as StagingVenueId;
const S_ACT_ID    = 'sa-001' as StagingActivityId;
const VENUE_ID    = 'venue-001' as PublicVenueId;

// Level 3, 2026-09-23 — identidade estável desta fixture, usada para
// calcular o engine_activity_id esperado nos testes abaixo. Mesmo par
// (sourceKey, sourceItemId) do golden vector em activityIdentity.test.ts.
const SOURCE_ITEM_ID = '146007_0';
const EXPECTED_ENGINE_ACTIVITY_ID = '7235d91b-a8d5-52fe-8645-4b6b41e09f43';

const PUBLISHED_AT = new Date('2026-07-09T12:00:00.000Z');
// asOf usado nos testes de activity — "agora", para efeitos de selecção de
// ocorrência futura (ADR-0020). Distinto de PUBLISHED_AT propositadamente,
// para provar que os dois papéis (timestamp de escrita vs referência
// temporal de selecção) são independentes.
const AS_OF = new Date('2026-07-09T00:00:00.000Z');

const fullVenue: PublishableVenue = {
  stagingId:        S_VENUE_ID,
  productKey:       'vivere-60-mais',
  sourceKey:        'google_places',
  name:             'Praia do Forte',
  address:          'Cabo Frio - RJ',
  lat:              -22.875,
  lng:              -42.008,
  phone:            '+55 22 99999-0000',
  website:          'https://example.com',
  openingHoursRaw:  'Mon-Fri 08:00-18:00',
  imageUrl:         'https://example.com/img.jpg',
  promotedVenueId:  null,
  stagingUpdatedAt: new Date('2026-07-01'),
  city:             'Cabo Frio',
};

const futureOccurrence: ActivityOccurrence = {
  date: '2026-08-01', time: '09:00', endDate: '2026-08-01', endTime: '10:00',
};

function makeActivity(overrides: Partial<PublishableActivity> = {}): PublishableActivity {
  return {
    stagingId:             S_ACT_ID,
    productKey:            'vivere-60-mais',
    sourceKey:             'prefeitura_cabo_frio',
    sourceItemId:          SOURCE_ITEM_ID,
    title:                 'Yoga no Forte',
    description:           'Aula de yoga na praia',
    occurrences:           [futureOccurrence],
    startDate:             null,
    endDate:               null,
    imageUrl:              'https://example.com/yoga.jpg',
    sourceUrl:             'https://cabofrio.rj.gov.br/yoga',
    phone:                 '+55 22 98888-0000',
    resolvedPublicVenueId: VENUE_ID,
    venueResolutionStatus:  'matched',
    resolvedVenueStagingId: S_VENUE_ID,
    promotedActivityId:    null,
    stagingUpdatedAt:      new Date('2026-07-01'),
    // Activity 9/26, 2026-09-27 — default: evento único, sem recorrência.
    recurrenceType:        null,
    recurrenceDays:        null,
    recurrenceTime:        null,
    ...overrides,
  };
}

const fullActivity = makeActivity();

// ── transformVenue ──────────────────────────────────────────────────

describe('PublicationTransformer.transformVenue', () => {
  it('mapeia todos os campos da whitelist ADR-0018 (COPY)', () => {
    const result = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);

    expect(result.name).toBe('Praia do Forte');
    expect(result.address).toBe('Cabo Frio - RJ');
    expect(result.lat).toBe(-22.875);
    expect(result.lng).toBe(-42.008);
    expect(result.phone).toBe('+55 22 99999-0000');
    expect(result.website).toBe('https://example.com');
    expect(result.image_url).toBe('https://example.com/img.jpg');
    expect(result.engine_venue_id).toBe(S_VENUE_ID);
    expect(result.source_key).toBe('google_places');
    expect(result.product_key).toBe('vivere-60-mais');
  });

  it('opening_hours é COPY puro — sem qualquer normalização (Questão A)', () => {
    const result = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    expect(result.opening_hours).toBe('Mon-Fri 08:00-18:00');
  });

  it('engine_status é sempre "active" (gerado)', () => {
    const result = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    expect(result.engine_status).toBe('active');
  });

  it('last_published_at é exactamente o valor injectado, nunca gerado internamente', () => {
    const result = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    expect(result.last_published_at).toBe(PUBLISHED_AT);
  });

  it('preserva null nos campos opcionais quando ausentes em staging/raw', () => {
    const bareVenue: PublishableVenue = {
      ...fullVenue,
      address: null, lat: null, lng: null, phone: null,
      website: null, openingHoursRaw: null, imageUrl: null,
    };
    const result = PublicationTransformer.transformVenue(bareVenue, PUBLISHED_AT);

    expect(result.address).toBeNull();
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.website).toBeNull();
    expect(result.opening_hours).toBeNull();
    expect(result.image_url).toBeNull();
  });

  it('nunca expõe campos fora da whitelist (category, city)', () => {
    const result = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    const keys = Object.keys(result);

    expect(keys).not.toContain('category');
    expect(keys).not.toContain('city'); // ausente da whitelist ADR-0018 (diverge do Architecture Book §5.1)
  });

  it('produz exactamente os 13 campos da whitelist — nada a mais, nada a menos', () => {
    const result = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    expect(Object.keys(result).sort()).toEqual([
      'address', 'engine_status', 'engine_venue_id', 'image_url', 'last_published_at',
      'lat', 'lng', 'name', 'opening_hours', 'phone', 'product_key', 'source_key', 'website',
    ].sort());
  });
});

// ── transformActivity ──────────────────────────────────────────────────

describe('PublicationTransformer.transformActivity', () => {
  it('mapeia todos os campos da whitelist ADR-0018 (COPY), com start_date/end_date da próxima ocorrência', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Yoga no Forte');
    expect(result!.description).toBe('Aula de yoga na praia');
    expect(result!.start_date).toEqual(new Date('2026-08-01T09:00:00.000Z'));
    expect(result!.end_date).toEqual(new Date('2026-08-01T10:00:00.000Z'));
    expect(result!.url).toBe('https://cabofrio.rj.gov.br/yoga');
    expect(result!.phone).toBe('+55 22 98888-0000');
    expect(result!.venue_id).toBe(VENUE_ID);
    // Level 3, 2026-09-23 — já não é S_ACT_ID (stagingId bruto); é a
    // identidade estável derivada de (sourceKey, sourceItemId).
    expect(result!.engine_activity_id).toBe(EXPECTED_ENGINE_ACTIVITY_ID);
    expect(result!.source_key).toBe('prefeitura_cabo_frio');
    expect(result!.product_key).toBe('vivere-60-mais');
  });

  it('usa imagem_url (typo intencional, ADR-0015) — nunca image_url', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    const keys = Object.keys(result!);

    expect(result!.imagem_url).toBe('https://example.com/yoga.jpg');
    expect(keys).not.toContain('image_url');
  });

  it('venue_id aceita null — activity proposed_new (Architecture Book §5.3)', () => {
    const proposedNew = makeActivity({ resolvedPublicVenueId: null, venueResolutionStatus: 'proposed_new', resolvedVenueStagingId: null });
    const result = PublicationTransformer.transformActivity(proposedNew, PUBLISHED_AT, AS_OF);
    expect(result!.venue_id).toBeNull();
  });

  it('engine_status é sempre "active" (gerado)', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(result!.engine_status).toBe('active');
  });

  it('last_published_at é exactamente o valor injectado, nunca gerado internamente', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(result!.last_published_at).toBe(PUBLISHED_AT);
  });

  it('nunca expõe campos preservados (ADR-0018): category, schedule, price, is_free, is_sponsored, interested_count', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    const keys = Object.keys(result!);

    // Activity 9/26, 2026-09-27 — recurrence_type/days/time SAÍRAM desta
    // lista (ADR-0018 revisto) — ver describe 'Recurrence' abaixo, que
    // confirma explicitamente que ESTES campos AGORA SÃO produzidos.
    for (const forbidden of [
      'category', 'schedule', 'price', 'is_free', 'is_sponsored', 'interested_count',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('produz exactamente os 16 campos da whitelist (Activity 9/26: +recurrence_type/days/time) — nada a mais, nada a menos', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(Object.keys(result!).sort()).toEqual([
      'description', 'end_date', 'engine_activity_id', 'engine_status', 'imagem_url',
      'last_published_at', 'phone', 'product_key', 'recurrence_days', 'recurrence_time',
      'recurrence_type', 'source_key', 'start_date', 'title', 'url', 'venue_id',
    ].sort());
  });
});

// ── transformActivity — múltiplas ocorrências e expiração (ADR-0020) ──────

describe('PublicationTransformer.transformActivity — ADR-0020', () => {
  it('selecciona a primeira ocorrência futura entre várias, ordenadas ou não', () => {
    const activity = makeActivity({
      occurrences: [
        { date: '2026-09-01', time: null, endDate: null, endTime: null }, // mais distante
        { date: '2026-07-15', time: '10:00', endDate: null, endTime: null }, // próxima futura
        { date: '2026-06-01', time: null, endDate: null, endTime: null }, // já passou
      ],
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result!.start_date).toEqual(new Date('2026-07-15T10:00:00.000Z'));
  });

  it('ocorrência exactamente igual a asOf conta como futura (>=)', () => {
    const activity = makeActivity({
      occurrences: [{ date: '2026-07-09', time: '00:00', endDate: null, endTime: null }],
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result).not.toBeNull();
  });

  it('devolve null quando todas as ocorrências já passaram e não há recorrência válida — nunca cai para a última passada', () => {
    const activity = makeActivity({
      occurrences: [
        { date: '2026-01-01', time: null, endDate: null, endTime: null },
        { date: '2026-06-01', time: null, endDate: null, endTime: null },
      ],
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result).toBeNull();
  });

  it('devolve null quando occurrences está vazio e não há recorrência válida', () => {
    const activity = makeActivity({ occurrences: [] });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result).toBeNull();
  });

  it('end_date fica null quando a ocorrência seleccionada não tem endDate', () => {
    const activity = makeActivity({
      occurrences: [{ date: '2026-08-01', time: '09:00', endDate: null, endTime: null }],
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result!.end_date).toBeNull();
  });

  it('mesmo activity + mesmo asOf → sempre a mesma ocorrência seleccionada (determinismo)', () => {
    const r1 = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    const r2 = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(r1).toEqual(r2);
  });
});

// ── transformActivity — Activity 9/26 Recurrence ──────────────────────

describe('PublicationTransformer.transformActivity — Activity 9/26 Recurrence', () => {
  it('A. staging NULL/NULL/NULL → public recurrence_type="none", days/time NULL', () => {
    const activity = makeActivity({ recurrenceType: null, recurrenceDays: null, recurrenceTime: null });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).not.toBeNull();
    expect(result!.recurrence_type).toBe('none');
    expect(result!.recurrence_days).toBeNull();
    expect(result!.recurrence_time).toBeNull();
  });

  it('B. weekly single day → passthrough directo', () => {
    const activity = makeActivity({ recurrenceType: 'weekly', recurrenceDays: [5], recurrenceTime: '10:00' });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result!.recurrence_type).toBe('weekly');
    expect(result!.recurrence_days).toEqual([5]);
    expect(result!.recurrence_time).toBe('10:00');
  });

  it('C. weekly multiple days → passthrough directo', () => {
    const activity = makeActivity({ recurrenceType: 'weekly', recurrenceDays: [3, 5], recurrenceTime: '09:00' });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result!.recurrence_days).toEqual([3, 5]);
    expect(result!.recurrence_time).toBe('09:00');
  });

  it('J. RECURRENCE-ONLY — occurrences=[], weekly válido → publicável, start_date=NULL, end_date=NULL, nunca skip_expired', () => {
    const activity = makeActivity({
      occurrences: [],
      recurrenceType: 'weekly',
      recurrenceDays: [5],
      recurrenceTime: '10:00',
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).not.toBeNull(); // NÃO é tratado como skip_expired
    expect(result!.start_date).toBeNull();
    expect(result!.end_date).toBeNull();
    expect(result!.recurrence_type).toBe('weekly');
    expect(result!.recurrence_days).toEqual([5]);
    expect(result!.recurrence_time).toBe('10:00');
  });

  it('recurrence + ocorrência concreta simultâneas — comportamento temporal existente preservado, recurrence escrito de qualquer forma', () => {
    const activity = makeActivity({
      occurrences: [futureOccurrence],
      recurrenceType: 'weekly',
      recurrenceDays: [5],
      recurrenceTime: '10:00',
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    // start_date/end_date vêm da ocorrência concreta, como sempre:
    expect(result!.start_date).toEqual(new Date('2026-08-01T09:00:00.000Z'));
    expect(result!.end_date).toEqual(new Date('2026-08-01T10:00:00.000Z'));
    // recurrence escrito de qualquer forma:
    expect(result!.recurrence_type).toBe('weekly');
    expect(result!.recurrence_days).toEqual([5]);
  });

  it('K. LOSS-AWARE — weekly, days=[2,5], time=NULL → publicável, recurrence_time permanece NULL, sem horário inventado', () => {
    const activity = makeActivity({
      occurrences: [],
      recurrenceType: 'weekly',
      recurrenceDays: [2, 5],
      recurrenceTime: null,
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).not.toBeNull();
    expect(result!.recurrence_days).toEqual([2, 5]);
    expect(result!.recurrence_time).toBeNull();
  });

  it('L. INVALID/INCOMPLETE — weekly sem recurrence_days, sem occurrence → NÃO publicável (null, como antes desta Activity)', () => {
    const activity = makeActivity({
      occurrences: [],
      recurrenceType: 'weekly',
      recurrenceDays: [], // incompleto — weekly exige dias
      recurrenceTime: null,
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).toBeNull();
  });

  it('L (continuação). recurrence_days NULL com weekly, sem occurrence → NÃO publicável', () => {
    const activity = makeActivity({
      occurrences: [],
      recurrenceType: 'weekly',
      recurrenceDays: null,
      recurrenceTime: null,
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).toBeNull();
  });

  it('L (continuação 2). recurrence_type inválido/desconhecido, sem occurrence → NÃO publicável, tratado como sem recorrência', () => {
    const activity = makeActivity({
      occurrences: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- valor deliberadamente inválido para o teste
      recurrenceType: 'yearly' as any,
      recurrenceDays: [1],
      recurrenceTime: '10:00',
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).toBeNull();
  });

  it('L (continuação 3). estado inválido MAS com occurrence concreta → publica, recurrence_type cai para "none" (nunca publica o estado quebrado)', () => {
    const activity = makeActivity({
      occurrences: [futureOccurrence],
      recurrenceType: 'weekly',
      recurrenceDays: [], // incompleto
      recurrenceTime: '10:00',
    });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);

    expect(result).not.toBeNull(); // publica, por causa da ocorrência concreta
    expect(result!.recurrence_type).toBe('none'); // mas NUNCA como 'weekly' quebrado
    expect(result!.recurrence_days).toBeNull();
    expect(result!.recurrence_time).toBeNull();
  });

  it('M. NON-RECURRING REGRESSION — evento normal com ocorrência futura publica exactamente como antes', () => {
    const result = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(result).not.toBeNull();
    expect(result!.start_date).toEqual(new Date('2026-08-01T09:00:00.000Z'));
    expect(result!.recurrence_type).toBe('none');
  });

  it('M (continuação). NON-RECURRING REGRESSION — evento normal sem ocorrência futura continua null (skip/archive), como antes', () => {
    const activity = makeActivity({ occurrences: [], recurrenceType: null, recurrenceDays: null, recurrenceTime: null });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result).toBeNull();
  });

  it('recurrence_time nunca é convertido — permanece a mesma string local, sem UTC', () => {
    const activity = makeActivity({ recurrenceType: 'weekly', recurrenceDays: [5], recurrenceTime: '10:00' });
    const result = PublicationTransformer.transformActivity(activity, PUBLISHED_AT, AS_OF);
    expect(result!.recurrence_time).toBe('10:00'); // string idêntica, nenhuma conversão
  });
});

// ── Pureza e determinismo ──────────────────────────────────────────────

describe('PublicationTransformer — pureza e determinismo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('não usa o relógio do sistema — ignora Date.now() mesmo quando mockado', () => {
    // O relógio do sistema é fixado num valor DIFERENTE do publishedAt/asOf injectados.
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));

    const venueResult    = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    const activityResult = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);

    // Se o Transformer chamasse new Date()/Date.now() internamente, o resultado
    // reflectiria 2099 (ou devolveria null, por a ocorrência já ter "passado"
    // em 2099). Isto prova que não o faz.
    expect(venueResult.last_published_at).toBe(PUBLISHED_AT);
    expect(activityResult).not.toBeNull();
    expect(activityResult!.last_published_at).toBe(PUBLISHED_AT);
    expect(venueResult.last_published_at.getFullYear()).toBe(2026);
    expect(activityResult!.last_published_at.getFullYear()).toBe(2026);
  });

  it('mesma entrada + mesmo publishedAt → saída deep-equal em execuções repetidas (venue)', () => {
    const r1 = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    const r2 = PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    expect(r1).toEqual(r2);
  });

  it('mesma entrada + mesmo publishedAt/asOf → saída deep-equal em execuções repetidas (activity)', () => {
    const r1 = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    const r2 = PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(r1).toEqual(r2);
  });

  it('não muta o objecto PublishableVenue de entrada', () => {
    const snapshot = { ...fullVenue };
    PublicationTransformer.transformVenue(fullVenue, PUBLISHED_AT);
    expect(fullVenue).toEqual(snapshot);
  });

  it('não muta o objecto PublishableActivity de entrada', () => {
    const snapshot = { ...fullActivity };
    PublicationTransformer.transformActivity(fullActivity, PUBLISHED_AT, AS_OF);
    expect(fullActivity).toEqual(snapshot);
  });
});
