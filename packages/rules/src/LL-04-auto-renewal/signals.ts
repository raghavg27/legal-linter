// Text signals shared by the static and runtime checks.

/** Says the subscription renews on its own. Paired with CANCEL to count as a renewal disclosure. */
export const RENEWAL =
  /auto(matic(ally)?)?[- ]?renew|renews? (automatically|each|every|monthly|annually|yearly|until)|recurring (charge|payment|billing|subscription)|until (you )?cancel(l?ed)?|billed (monthly|annually|yearly|every)|charged (monthly|annually|yearly|every)/i;
export const CANCEL = /cancel/i;

export function hasRenewalDisclosure(text: string): boolean {
  return RENEWAL.test(text) && CANCEL.test(text);
}

/** A price with a billing period next to it: "$29/mo", "€9 per month", "$290 billed annually". */
const RECURRING_PRICE = [
  /(\$|€|£|₹)\s?\d[\d.,]*\s*(\/\s?|per\s+|a\s+)(mo|month|yr|year|wk|week|user|seat)\b/i,
  /(\$|€|£|₹)\s?\d[\d.,]*[^.\n]{0,40}\b(billed (monthly|annually|yearly)|monthly|annually|yearly)\b/i,
];

export function hasRecurringPrice(text: string): boolean {
  return RECURRING_PRICE.some((re) => re.test(text));
}

export const GAP = {
  disclosure: 'No automatic-renewal terms near the checkout (that it renews until cancelled, and how to cancel)',
  consent: 'No unchecked consent checkbox for the renewal terms',
  preChecked: 'Consent checkbox for the renewal terms is pre-checked',
  cancel: 'No way to cancel online (billing portal, cancel route or cancel call)',
  confirmation: 'No confirmation email that states the subscription terms',
  page: 'Page shows recurring prices but no automatic-renewal terms (that it renews until cancelled, and how to cancel)',
} as const;

export const PHRASE: Record<string, string> = {
  [GAP.disclosure]: 'renewal terms beside the pay button',
  [GAP.consent]: 'a separate unchecked consent box',
  [GAP.preChecked]: 'a consent box that is not pre-checked',
  [GAP.cancel]: 'a way to cancel online',
  [GAP.confirmation]: 'a confirmation email with the terms',
};

export const ARL_RISK =
  "California's Automatic Renewal Law treats renewals charged without these safeguards as unconditional gifts, which drives refund demands for every renewal.";
