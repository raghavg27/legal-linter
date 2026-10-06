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

## Noticed while reading rules not built yet (check before milestone 2)

- **LL-02:** "Transactional email (receipts, password resets) is exempt." As we understand it, CAN-SPAM still applies some requirements to transactional messages (for example, header information must not be misleading). Please confirm whether "exempt" is the right word in findings.
- **LL-03:** "Applies when: Any site with California visitors." The intake asks for countries, not states, so we plan to treat "serves the US" as "has California visitors".
- **LL-05:** The trap and the intake speak of uploads hosted *publicly*, while "Applies when" says "any product with user-generated content". Which scope should the rule use? The rulebook also says intake asks for the Copyright Office registration, but that question is missing from the intake list; we added `dmcaAgentRegistered`.
