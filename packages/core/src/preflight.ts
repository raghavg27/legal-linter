import type { Rule } from './types.ts';

// Compares the text that a coding agent gives for the work that it will start with the
// topics of each rule. Plain word matching: the result lists the topic that matched. Thus the
// agent (and each person who reads the result) can see why the result includes a rule.

/** Lowercase words. A plural "s" at the end is removed, thus "uploads" matches "upload". */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function indexOfRun(haystack: string[], needle: string[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Removes each phrase that only looks like a topic, for example "font size" for the fonts rule. */
function withoutPhrases(text: (string | null)[], phrases: readonly string[]): (string | null)[] {
  const out = [...text];
  for (const phrase of phrases) {
    const p = words(phrase);
    for (let i = indexOfRun(out as string[], p); i >= 0; i = indexOfRun(out as string[], p)) out.fill(null, i, i + p.length);
  }
  return out;
}

export interface TopicMatch {
  rule: Rule;
  /** The rule topics that the description contains. */
  matchedOn: string[];
}

export function matchTopics(description: string, rules: readonly Rule[]): TopicMatch[] {
  const text = words(description);
  const matches: TopicMatch[] = [];
  for (const rule of rules) {
    const remaining = withoutPhrases(text, rule.meta.notTopics ?? []) as string[];
    const matchedOn = rule.meta.topics.filter((t) => indexOfRun(remaining, words(t)) >= 0);
    if (matchedOn.length > 0) matches.push({ rule, matchedOn });
  }
  return matches;
}
