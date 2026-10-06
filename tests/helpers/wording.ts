// Findings describe what was observed and the risk; they never conclude that the
// user is breaking the law, and never promise that a fix makes them compliant.
const BANNED = /\b(violat\w*|non-?compliant|compliant|compliance|illegal|unlawful|breach\w*|guarantee\w*)\b/i;

export function bannedWording(text: string): string | null {
  return BANNED.exec(text)?.[0] ?? null;
}

/** Counts sentence ends; a period inside a host name like fonts.gstatic.com is not one. */
export function sentenceCount(text: string): number {
  return (text.trim().match(/[.!?](?=\s|$)/g) ?? []).length;
}
