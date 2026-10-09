const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/**
 * Turn pasted portal text (one card per line) into clean, unique card names.
 * Decodes HTML entities (the portal copy contains "&amp;"), collapses runs of
 * whitespace, and drops blanks and case-insensitive duplicates (first wins).
 */
export function parseCardList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line
      .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
