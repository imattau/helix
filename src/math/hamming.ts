/** Number of differing characters between two equal-length strings. Throws on length mismatch. */
export function hamming_distance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new RangeError(`hamming_distance: strings must be equal length (${a.length} vs ${b.length})`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}
