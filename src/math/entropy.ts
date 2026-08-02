/** Shannon entropy (bits/char, base-2 log) over the character distribution of a string. */
export function calculate_entropy(text: string): number {
  if (text.length === 0) return 0;

  const counts = new Map<string, number>();
  let n = 0;
  for (const ch of text) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
    n++;
  }

  let h = 0;
  for (const count of counts.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}
