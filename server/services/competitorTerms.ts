


const NON_ANSWERS = new Set(['nothing', 'none', 'no one', 'nobody', 'n/a', 'na', 'unknown']);


const DESCRIPTIVE_OPENERS = /^(individual|various|several|some|other|generic|custom|in-house|internal|manual|paper|word of mouth)\b/i;

export const MAX_TERMS = 3;
const MAX_TERM_LENGTH = 40;


export function competitorSearchTerms(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];

  const withoutAsides = raw.replace(/\([^)]*\)/g, ' ');
  const fragments = withoutAsides.split(/[,;\n]|\band\b|\bor\b/i);

  const terms: string[] = [];
  const seen = new Set<string>();

  for (const fragment of fragments) {
    const term = fragment
      .replace(/[.!?]+$/, '')
      .replace(/^\s*(and|or)\s+/i, '')
      .trim();

    if (!term) continue;
    if (NON_ANSWERS.has(term.toLowerCase())) continue;
    if (DESCRIPTIVE_OPENERS.test(term)) continue;
    if (term.length > MAX_TERM_LENGTH) continue;

    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);

    if (terms.length === MAX_TERMS) break;
  }

  return terms;
}
