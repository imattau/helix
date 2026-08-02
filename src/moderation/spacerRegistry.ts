import { generateSimhash, hammingDistance64, simhashFromHex, simhashToHex } from '../math/simhash.js';
import type { Spacer } from '../types/index.js';

/**
 * 64-bit fingerprint. Measured on short (tweet-length) post content: genuine
 * paraphrases land at 5-10 bits apart, unrelated content at 27+ - see src/math/simhash.ts
 * for why word-level (not multi-word n-gram) shingling was chosen for this length of text.
 */
const DEFAULT_THRESHOLD_BITS = 12;

export interface MisinfoCheck {
  isMisinfo: boolean;
  matchedSpacer?: Spacer;
  distance?: number;
}

/**
 * CRISPR spacer registry: flags near-duplicate/paraphrased misinformation via SimHash
 * Hamming distance. A plain linear scan, not a Bloom filter - see the project plan for
 * why a Bloom filter can't answer this "fuzzy" query and would silently miss exactly
 * the paraphrased content SimHash exists to catch. Fine at prototype/demo scale (a few
 * thousand spacers); a production system would need banded LSH indexing to scale further.
 */
export class SpacerRegistry {
  private spacers: Spacer[] = [];

  submitSpacer(content: string, postId: string, evidenceHash: string, submittedBy: string): Spacer {
    const spacer: Spacer = {
      postId,
      simhashHex: simhashToHex(generateSimhash(content)),
      evidenceHash,
      submittedBy,
    };
    this.spacers.push(spacer);
    return spacer;
  }

  checkContent(content: string, thresholdBits = DEFAULT_THRESHOLD_BITS): MisinfoCheck {
    const fingerprint = generateSimhash(content);
    let best: { spacer: Spacer; distance: number } | undefined;

    for (const spacer of this.spacers) {
      const distance = hammingDistance64(fingerprint, simhashFromHex(spacer.simhashHex));
      if (!best || distance < best.distance) {
        best = { spacer, distance };
      }
    }

    if (best && best.distance <= thresholdBits) {
      return { isMisinfo: true, matchedSpacer: best.spacer, distance: best.distance };
    }
    return { isMisinfo: false };
  }
}
