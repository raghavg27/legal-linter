# Legal review queue

These items are for the lawyer. We copied the figures and dates of the rulebook as they are written. We did not correct them. This file lists the items that possibly have a problem, and the text that we had to write ourselves.

## Items for all rules

- **No source links or review dates.** The rulebook does not give them. Thus each `legal.yaml` has `sources: []` and `lastReviewed: null`. Please give links to primary sources and a review date for each rule.
- **Text that we wrote, not copied from the rulebook:** for each rule, the `doesNotApplyIf`, the `exposureKind` label (statutory maximum, named case or consequence), the finding explanations with two sentences in the detector code, and the fix guidance in `fix.yaml`.
- **Disclaimer text:** "Legal Lint describes what it observed and the risk it may create. It is not legal advice."

- **Text that we added in milestone 4:**
  - MCP server instructions: "Results describe observed risk; they are not legal advice, and fixing a finding is not a promise that the product meets the law."
  - Pre-flight check: "Legal Lint covers only a few specific traps, so an empty result does not mean the feature is legally clear."
  - The headline and section text of the HTML report, for example "Nothing to fix right now." and "Whether these apply depends on your business."
  Please confirm that a reader cannot think that "Nothing to fix right now" means that the product has no legal problems.
- **Judgments that an AI agent makes.** A coding agent can now answer if an email is marketing or transactional. A "transactional" answer removes the finding. The project config keeps the answer and the reason of the agent, so that the owner can review them. Is it acceptable to rely on this answer? Or should the owner confirm each finding that the answer removes?

## LL-01 · Google Fonts

- `doesNotApplyIf`: "The site or app has no visitors from the EU or EEA." Please confirm.
- `exposureKind`: the label is **named case** (the Munich judgment).
- **UK visitors.** The intake asks one question for the EU and the UK together. Thus a "yes" for only the UK makes LL-01 apply, but the rule refers to GDPR and a German court. Is this correct under UK GDPR? Or should the intake have two separate questions?
- **Preconnect.** The rule reports a `<link rel="preconnect">` to the Google font hosts (medium confidence), also when no font downloads. The reason is that the connection itself shows the IP address. Please confirm that this has the same risk.
- **Explanation text:** the findings say "For EU visitors, this is the pattern behind the 2022 Munich court ruling and the wave of warning letters that followed."

## LL-02 · Marketing email

- `doesNotApplyIf`: "The email is transactional (a receipt, password reset or account notice), or no recipients are in the US."
- `exposureKind`: **statutory maximum** ("Up to $53,088 per email").
- **"Exempt".** The rulebook says "Transactional email (receipts, password resets) is exempt." We think that CAN-SPAM still applies some requirements to transactional messages. For example, the header information must not be misleading. Please confirm if "exempt" is the correct word in findings.
- **Text of the judgment question** for the coding agent: "Is this email marketing (a newsletter, promotion, announcement or re-engagement message) or transactional (a receipt, password reset, or an update about the recipient's own account or order)?" Welcome emails and onboarding emails get this question. How should we treat them?
- **Explanation text:** "Commercial email without an unsubscribe option, a postal address and suppression of opt-outs is the CAN-SPAM risk, with penalties counted per email."
- **Applicability.** The rule applies when the intake says that the product sends marketing email and serves the US. Should the rule also apply to companies outside the US that send email to some recipients in the US?

## LL-03 · Session replay

- `doesNotApplyIf`: "The site has no visitors from California."
- `exposureKind`: the label is **statutory maximum** for "$5,000 per violation in statutory damages". This is a fixed statutory amount, not a maximum. Is "statutory maximum" an acceptable label?
- **Visitors from California.** The intake asks for countries, not states. Thus the rule thinks that "serves the US" means "has visitors from California".
- **Explanation text:** "Under California's Invasion of Privacy Act, recording visitors before telling them is the basis of class demand letters seeking statutory damages."
- **Scope.** The rule finds only the five tools that the rulebook names.

## LL-04 · Subscription renewal

- `doesNotApplyIf`: "No subscriptions are sold, or none are sold to consumers in California."
- `exposureKind`: the label is **consequence**.
- **The exposure line of the rulebook says "without compliant consent".** Findings show it word for word. It describes the effect of the law, not the user. But please confirm that it is acceptable, because our rule is that we never tell the user that they are non-compliant.
- **What the rule accepts as a disclosure** (renewal text and "cancel" near the pay button) **and as consent** (a checkbox that is not checked by default, with agree or consent text). Please confirm that these are the correct minimum signals. The fix guidance also lists the price, the period and the trial conversion.
- **We wrote the "why" text of the fix guidance:** "The consent to the renewal terms should be a separate action. The customer ticks an empty box..." and "Customers who signed up online should not have to send an email or call to stop the payments."

## LL-05 · DMCA agent

- `doesNotApplyIf`: "Users cannot upload or post content that the product hosts."
- `exposureKind`: **statutory maximum** (the line "up to $150,000 if willful").
- **Scope.** The trap and the intake are about uploads that are hosted *publicly*. But "Applies when" says "any product with user-generated content". We apply the rule when the intake says that the uploads are hosted publicly. Which scope is correct?
- **Our explanations say** that an agent that is missing, that cannot be reached or that is not registered "can cost the app its DMCA safe harbor for what users upload." Please confirm the text.
- **Fix guidance.** It lists the items of a notice ("the work, the location of the work on the site, contact details, a good-faith statement and a signature"), a counter-notice section and a repeat-infringer policy. We wrote this text. Please review it.

## Hosted service (milestone 5)

- **Scans of sites that other persons own.** The hosted scanner loads each public URL that a key holder gives it. This can be a site that the key holder does not own. Does the service need terms of use? For example, terms that permit scans only of sites that the user owns or has permission to test, or a robots.txt rule. (We did not do milestone 3, which had the robots.txt support.)
- **Privacy text.** The section "Data that goes out of your machine" in the README now describes the licence check and the hosted scans. Please confirm that it is correct and sufficient as a privacy notice. Also tell us if the service needs a separate privacy policy.
- **Logs.** The service logs the key prefix, the host of the site, the outcome and the duration. During setup, it can log X-Forwarded-For (IP addresses) for a short time. Is a retention period or a notice necessary?
- **The request logs of Cloud Run.** Google Cloud Run also records each request with the client IP address and the user agent by default. This is separate from the logs of our code. The README does not tell about this. Should it tell about it? Is a retention setting necessary?
- **Messages that we wrote:** "Legal Lint needs a licence key…", "The hosted scanner has used its scans for this month…", and "… is not a public web address on port 80 or 443, so the hosted scanner will not load it." These messages contain no legal claims. We list them only so that the list is complete.
