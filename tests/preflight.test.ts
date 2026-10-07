import { describe, expect, it } from 'vitest';
import { matchTopics } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';

// What a coding agent might say it is about to build, and the rules that should come up.
// Near misses contain a topic word but are about something else; they must stay quiet.
const CASES: { building: string; rules: string[] }[] = [
  { building: 'Stripe subscriptions', rules: ['LL-04'] },
  { building: 'add Stripe', rules: ['LL-04'] },
  { building: 'a pricing page with monthly and yearly plans', rules: ['LL-04'] },
  { building: 'Paddle checkout with a free trial', rules: ['LL-04'] },
  { building: 'Hotjar', rules: ['LL-03'] },
  { building: 'PostHog product analytics', rules: ['LL-03'] },
  { building: 'session recording with LogRocket', rules: ['LL-03'] },
  { building: 'newsletter signup', rules: ['LL-02'] },
  { building: 'send onboarding emails with Resend', rules: ['LL-02'] },
  { building: 'image uploads', rules: ['LL-05'] },
  { building: 'let users upload avatars to Supabase Storage', rules: ['LL-05'] },
  { building: 'a community forum with comments', rules: ['LL-05'] },
  { building: 'Google Fonts for the landing page', rules: ['LL-01'] },
  { building: 'switch the body font to Inter', rules: ['LL-01'] },
  { building: 'Material Symbols icons', rules: ['LL-01'] },
  { building: 'a waitlist landing page', rules: ['LL-01', 'LL-02'] },
  // Near misses.
  { building: 'dark mode toggle', rules: [] },
  { building: 'Font Awesome icons', rules: [] },
  { building: 'increase the font size on mobile', rules: [] },
  { building: 'validate the email field on the signup form', rules: [] },
  { building: 'save drafts in local storage', rules: [] },
  { building: 'auth with magic links', rules: [] },
  { building: 'blog posts written by the team', rules: [] },
];

describe('pre-flight topic matching', () => {
  for (const c of CASES) {
    it(`"${c.building}" → ${c.rules.join(', ') || 'nothing'}`, () => {
      expect(matchTopics(c.building, rules).map((m) => m.rule.meta.id)).toEqual(c.rules);
    });
  }

  it('says which topic matched', () => {
    const [m] = matchTopics('Stripe subscriptions', rules);
    expect(m!.matchedOn).toEqual(['subscriptions', 'stripe', 'stripe subscriptions']);
  });

  it('every rule has topics, and no exclusion swallows one of its own topics', () => {
    for (const rule of rules) {
      expect(rule.meta.topics.length).toBeGreaterThan(0);
      for (const topic of rule.meta.topics) {
        expect(matchTopics(topic, [rule]).map((m) => m.rule.meta.id), `${rule.meta.id} topic "${topic}"`).toEqual([rule.meta.id]);
      }
    }
  });
});
