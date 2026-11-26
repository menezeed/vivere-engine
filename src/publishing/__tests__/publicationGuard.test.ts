/**
 * Bloqueio de publicação internacional até U8 (piloto UK, 26/11/2026).
 */
import { describe, it, expect, vi } from 'vitest';
import { assertPublishableProduct, InternationalPublicationBlockedError, PUBLISHABLE_PRODUCT_KEYS } from '../publicationGuard';
import { PublishingEngine } from '../services/PublishingEngine';

describe('publicationGuard', () => {
  it('só vivere-60-mais é publicável', () => {
    expect([...PUBLISHABLE_PRODUCT_KEYS]).toEqual(['vivere-60-mais']);
    expect(() => assertPublishableProduct('vivere-60-mais')).not.toThrow();
  });

  it.each(['vivere-60-plus-uk-test', 'qualquer-outro'])('recusa %s com motivo U8', (key) => {
    expect(() => assertPublishableProduct(key)).toThrow(InternationalPublicationBlockedError);
    expect(() => assertPublishableProduct(key)).toThrow(/U8/);
  });

  it('PublishingEngine.publish recusa o produto UK ANTES de qualquer escrita (nem start da run)', async () => {
    const runRepo = { start: vi.fn(), finish: vi.fn(), fail: vi.fn() };
    const eventRepo = { record: vi.fn(), hasVenuePublishedEvent: vi.fn() };
    const venuePublisher = { publish: vi.fn(), preview: vi.fn() };
    const activityPublisher = { publish: vi.fn(), preview: vi.fn() };
    const engine = new PublishingEngine(
      venuePublisher as never, activityPublisher as never, runRepo as never, eventRepo as never,
    );
    await expect(engine.publish('vivere-60-plus-uk-test', 'test')).rejects.toThrow(InternationalPublicationBlockedError);
    expect(runRepo.start).not.toHaveBeenCalled();
    expect(venuePublisher.publish).not.toHaveBeenCalled();
    expect(activityPublisher.publish).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
  });
});
