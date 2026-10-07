# Legal review queue

Items for the lawyer. The rulebook's figures and dates are copied as written and have not been corrected; this file lists what looked off or what we had to write ourselves.

## Applies to every rule

- **No source links or review dates.** The rulebook gives neither, so each `legal.yaml` has `sources: []` and `lastReviewed: null`. Please supply primary-source links and a review date per rule.
- **Text written by us, not copied from the rulebook:** each rule's `doesNotApplyIf`, its `exposureKind` label (statutory maximum, named case or consequence), the two-sentence finding explanations in the detector code, and the fix guidance in `fix.yaml`.
- **Disclaimer wording:** "Legal Lint describes what it observed and the risk it may create. It is not legal advice."

## LL-01 · Google Fonts

- `doesNotApplyIf`: "The site or app has no visitors from the EU or EEA." Please confirm.
- `exposureKind`: labelled **named case** (the Munich judgment).
- **UK visitors.** The intake asks one combined EU/UK question, so a UK-only "yes" makes LL-01 apply, although the rule cites GDPR and a German court. Is that right under UK GDPR, or should the intake split the question?
- **Preconnect.** A `<link rel="preconnect">` to the Google font hosts is reported (medium confidence) even when no font is downloaded, on the reasoning that the connection itself reveals the IP. Please confirm this falls under the same risk.
- **Explanation wording:** findings say "For EU visitors, this is the pattern behind the 2022 Munich court ruling and the wave of warning letters that followed."

## LL-02 · Marketing email

- `doesNotApplyIf`: "The email is transactional (a receipt, password reset or account notice), or no recipients are in the US."
- `exposureKind`: **statutory maximum** ("Up to $53,088 per email").
- **"Exempt".** The rulebook says "Transactional email (receipts, password resets) is exempt." As we understand it, CAN-SPAM still applies some requirements to transactional messages (for example, header information must not be misleading). Please confirm whether "exempt" is the right word in findings.
- **Judgment question wording**, put to the coding agent: "Is this email marketing (a newsletter, promotion, announcement or re-engagement message) or transactional (a receipt, password reset, or an update about the recipient's own account or order)?" Welcome and onboarding emails land here. How should they be treated?
- **Explanation wording:** "Commercial email without an unsubscribe option, a postal address and suppression of opt-outs is the CAN-SPAM risk, with penalties counted per email."
- **Applicability.** The rule applies when the intake says the product sends marketing email and serves the US. Should non-US companies that email some US recipients be covered as well?

## LL-03 · Session replay

- `doesNotApplyIf`: "The site has no visitors from California."
- `exposureKind`: labelled **statutory maximum** for "$5,000 per violation in statutory damages". It is a fixed statutory amount rather than a cap; is "statutory maximum" an acceptable label?
- **California visitors.** The intake asks for countries, not states, so "serves the US" is treated as "has California visitors".
- **Explanation wording:** "Under California's Invasion of Privacy Act, recording visitors before telling them is the basis of class demand letters seeking statutory damages."
- **Scope.** Only the five tools the rulebook names are covered.

## LL-04 · Subscription renewal

- `doesNotApplyIf`: "No subscriptions are sold, or none are sold to consumers in California."
- `exposureKind`: labelled **consequence**.
- **The rulebook's exposure line says "without compliant consent".** It is shown word for word in findings. It describes the law's effect, not the user, but please confirm it reads acceptably next to our rule never to call the user non-compliant.
- **What counts as a disclosure** (renewal wording plus "cancel" near the pay button) and **as consent** (an unchecked checkbox with agree/consent wording). Please confirm these are the right minimum signals; the fix guidance also lists price, period and trial conversion.
- **The fix guidance's "why" text** is ours: "Consent to the renewal terms should be its own action: an unchecked box the customer ticks..." and "Customers who signed up online should not have to email or call to stop paying."

## LL-05 · DMCA agent

- `doesNotApplyIf`: "Users cannot upload or post content that the product hosts."
- `exposureKind`: **statutory maximum** (the "up to $150,000 if willful" line).
- **Scope.** The trap and the intake speak of uploads hosted *publicly*, while "Applies when" says "any product with user-generated content". We apply the rule when the intake says uploads are hosted publicly. Which scope is right?
- **Our explanations say** a missing, unreachable or unregistered agent "can cost the app its DMCA safe harbor for what users upload." Please confirm the wording.
- **Fix guidance.** It lists the elements of a notice ("the work, where it appears on the site, contact details, a good-faith statement and a signature"), a counter-notice section and a repeat-infringer policy. These are written by us; please review.
