// Findings describe what the detector saw and the risk. They never tell the user that
// they break the law. They never promise that a fix makes them compliant.
const BANNED = /\b(violat\w*|non-?compliant|compliant|compliance|illegal|unlawful|breach\w*|guarantee\w*)\b/i;

export function bannedWording(text: string): string | null {
  return BANNED.exec(text)?.[0] ?? null;
}

/** Counts the ends of sentences. A period in a host name such as fonts.gstatic.com is not the end of a sentence. */
export function sentenceCount(text: string): number {
  return (text.trim().match(/[.!?](?=\s|$)/g) ?? []).length;
}
