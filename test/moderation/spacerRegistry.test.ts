import { describe, expect, it } from 'vitest';
import { SpacerRegistry } from '../../src/moderation/spacerRegistry.js';

describe('SpacerRegistry', () => {
  it('flags a near-duplicate/paraphrased post that an exact hash match would miss', () => {
    const registry = new SpacerRegistry();
    const debunked = 'Drinking bleach cures the common cold according to unnamed doctors';
    registry.submitSpacer(debunked, 'post-1', 'evidence-hash-1', 'moderator-genome');

    const paraphrase = 'Drinking bleach cures the common cold according to unnamed experts';
    const result = registry.checkContent(paraphrase);

    expect(result.isMisinfo).toBe(true);
    expect(result.matchedSpacer?.postId).toBe('post-1');
    expect(result.distance).toBeLessThanOrEqual(12);
  });

  it('does not flag unrelated content', () => {
    const registry = new SpacerRegistry();
    registry.submitSpacer('Drinking bleach cures the common cold', 'post-1', 'evidence-1', 'mod');

    const result = registry.checkContent('The weather in Seattle is mild this time of year');
    expect(result.isMisinfo).toBe(false);
    expect(result.matchedSpacer).toBeUndefined();
  });

  it('does not flag exact-hash-different but semantically unrelated content just because both changed', () => {
    const registry = new SpacerRegistry();
    registry.submitSpacer('completely unrelated seed text for the registry', 'post-1', 'e', 'mod');
    const result = registry.checkContent('a totally different sentence about something else entirely');
    expect(result.isMisinfo).toBe(false);
  });

  it('returns the closest match when multiple spacers are registered', () => {
    const registry = new SpacerRegistry();
    registry.submitSpacer('Vaccines contain microchips for tracking citizens', 'post-1', 'e1', 'mod');
    registry.submitSpacer('The moon landing was filmed in a studio', 'post-2', 'e2', 'mod');

    const result = registry.checkContent('Vaccines contain microchips for tracking people');
    expect(result.matchedSpacer?.postId).toBe('post-1');
  });
});
