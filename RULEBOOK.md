# Legal Lint Rulebook v0.1

Source of truth for the first 15 rules. Each rule is a trap a founder ships by accident, a way to detect it, guidance for fixing it, and the exposure it carries.

Legal Lint reports and guides; it does not edit code. The user's AI coding agent (Claude Code, Cursor) receives the finding and the fix guidance through the MCP server and makes the change in the user's repo.

Detection methods:
- **static**: scan the repo, on the user's machine
- **runtime**: headless crawl of the live or preview URL
- **intake**: a questionnaire answer decides whether the rule applies

Fix types (what the guidance can achieve):
- **full**: an agent following the guidance can finish the fix in code
- **partial**: the agent can scaffold it, but the owner must do some steps (register an agent, confirm terms, write content). The guidance lists those owner steps separately.

Penalty figures are statutory maximums or notable cases. They were written from knowledge as of mid-2026 and must be re-verified against primary sources before a rule ships. Findings should describe risk, never assert a violation.

## Intake questions

Asked once per project, stored in `legal-lint.config.json`. Every rule reads from this.

- Countries served; are EU/UK visitors expected
- Audience: general, teens, under-13, or mixed
- Revenue band and user count (CCPA thresholds)
- Sells subscriptions (yes/no)
- Sends marketing email (yes/no), marketing SMS (yes/no)
- Hosts user uploads publicly (yes/no)
- Handles health or wellness data (yes/no)
- Serves video content (yes/no)
- Ships iOS or Android apps (yes/no)

## Build phases

| Phase | Rules | Notes |
|---|---|---|
| 1 (MVP) | LL-01 to LL-05 | Detection is reliable, fixes are mechanical |
| 2 | LL-06 to LL-10 | Needs intake properly (CCPA thresholds, COPPA audience) |
| 3 | LL-11 to LL-15 | Judgment-heavy, needs lawyer review first |

---

## LL-01 · Google Fonts loaded from Google's CDN

- **Phase**: 1 (MVP)
- **Region**: EU
- **Law**: GDPR Art. 6(1); LG München I, 3 O 17493/20 (20 Jan 2022)
- **Trap**: Fonts are pulled from `fonts.googleapis.com` or `fonts.gstatic.com`, so every visitor's IP address goes to Google before any consent.
- **Applies when**: Any site or app with EU/EEA visitors.
- **Detection** (static, runtime): Grep HTML, CSS `@import`, `_document`, layout files and Tailwind config for the two Google font hosts. Confirm at runtime by recording network requests on first load.
- **Fix** (full): Swap to `next/font/google` (self-hosts at build time) or `@fontsource` packages; remove the `<link>` tags.
- **Exposure**: €100 per claimant awarded in the Munich case, plus lawyer fees from the warning-letter wave that followed.
- **Detection confidence**: High

## LL-02 · Marketing email with no unsubscribe or postal address

- **Phase**: 1 (MVP)
- **Region**: US
- **Law**: CAN-SPAM Act, 15 U.S.C. §7704
- **Trap**: Newsletters or promo emails go out without a working unsubscribe link, a physical address, or a suppression check before sending.
- **Applies when**: Commercial email to US recipients. Transactional email (receipts, password resets) is exempt.
- **Detection** (static): Find send calls for Resend, SendGrid, Postmark, SES, Mailgun, Nodemailer. Each template is classified as marketing or transactional (obvious cases by heuristics, unclear ones by asking the user's coding agent through MCP), then the footer is checked, and whether an unsubscribe handler writes to a list the sender reads.
- **Fix** (full): Shared footer component, one-click `/unsubscribe` route, suppression check in the send wrapper, `List-Unsubscribe` headers (also needed for Gmail and Yahoo bulk-sender rules).
- **Exposure**: Up to $53,088 per email, the FTC's 2025 inflation-adjusted cap.
- **Detection confidence**: High for a missing footer; Medium for marketing vs transactional

## LL-03 · Session replay recording before consent

- **Phase**: 1 (MVP)
- **Region**: US
- **Law**: California Invasion of Privacy Act, Penal Code §631, §637.2
- **Trap**: FullStory, Hotjar, LogRocket, Clarity or PostHog recordings start at page load and capture clicks and keystrokes before the visitor is told.
- **Applies when**: Any site with California visitors.
- **Detection** (static, runtime): Dependency inventory for replay SDKs; check whether init sits inside a consent callback. At runtime, confirm recording endpoints are hit before any banner interaction.
- **Fix** (full): Wrap init in a consent gate, turn on input masking, add a disclosure line to the banner and privacy policy.
- **Exposure**: $5,000 per violation in statutory damages; mostly used as settlement leverage in class demand letters.
- **Detection confidence**: High

## LL-04 · Subscription that renews silently

- **Phase**: 1 (MVP)
- **Region**: US
- **Law**: California Automatic Renewal Law, Bus. & Prof. Code §17600 ff. (amended by AB 2863, effective 1 Jul 2025)
- **Trap**: Checkout lacks clear renewal terms next to the pay button, separate consent to those terms, a confirmation email, or a way to cancel online.
- **Applies when**: Subscriptions sold to California consumers.
- **Detection** (static, runtime): Find Stripe, Paddle, Lemon Squeezy or Razorpay subscription creation. Look for disclosure text in the checkout component, a consent checkbox, a billing-portal or cancel route, and a confirmation template that states the terms. Crawl the pricing page for the disclosure.
- **Fix** (partial): Disclosure block beside the CTA, unchecked consent box, Stripe customer-portal link in settings, confirmation and annual-reminder email templates. Owner confirms the exact terms.
- **Exposure**: Goods or services sent without compliant consent count as an unconditional gift, which drives refund demands for every renewal, plus unfair-competition claims.
- **Detection confidence**: Medium

## LL-05 · User uploads with no DMCA agent

- **Phase**: 1 (MVP)
- **Region**: US
- **Law**: 17 U.S.C. §512(c)(2)
- **Trap**: Users can upload images, files or text that the app hosts publicly, and no designated agent is registered or listed.
- **Applies when**: Any product with user-generated content.
- **Detection** (static, intake): Find upload handlers (multer, formidable, S3 presigned URLs, UploadThing, Cloudinary) whose output is rendered publicly. Look for a `/dmca` or copyright page with agent contact. Intake asks for the Copyright Office registration.
- **Fix** (partial): DMCA policy page, takedown request form, repeat-infringer policy. PR checklist tells the owner to register the agent with the US Copyright Office ($6, renewed every 3 years).
- **Exposure**: Without an agent you lose safe harbor. Statutory damages then run $750–$30,000 per work, up to $150,000 if willful.
- **Detection confidence**: High

## LL-06 · Analytics and ad pixels fire before consent

- **Phase**: 2
- **Region**: EU
- **Law**: ePrivacy Directive Art. 5(3); GDPR
- **Trap**: GA4, Meta Pixel, TikTok or LinkedIn Insight set cookies or send requests before the visitor accepts the banner.
- **Applies when**: EU, EEA and UK visitors.
- **Detection** (runtime, static): Headless visit from an EU exit point; list cookies and third-party requests before any click. Statically, find pixel snippets in layouts without a consent condition and check Consent Mode defaults.
- **Fix** (full): Gate scripts behind consent state, set Consent Mode v2 defaults to denied, add a lightweight banner if none exists.
- **Exposure**: Up to €20M or 4% of turnover in theory. For startups, the realistic outcome is a regulator order, a small fine or a warning letter.
- **Detection confidence**: High

## LL-07 · Global Privacy Control ignored

- **Phase**: 2
- **Region**: US
- **Law**: CCPA/CPRA, Cal. Civ. Code §1798.120, §1798.135; CPPA regs §7025
- **Trap**: Ad pixels keep sharing data when the browser sends a GPC opt-out signal, and there is no "Do Not Sell or Share" link.
- **Applies when**: Only above a CCPA threshold: about $26.6M revenue, 100,000 California consumers, or half of revenue from selling or sharing data. Intake decides.
- **Detection** (runtime, intake): Crawl with `Sec-GPC: 1` and `navigator.globalPrivacyControl = true`; check whether ad pixels still fire. Look for the footer link.
- **Fix** (full): GPC listener that disables sharing pixels, footer opt-out link and page.
- **Exposure**: $2,500 per violation, $7,500 if intentional (adjusted upward periodically). Sephora paid $1.2M in 2022, largely over GPC.
- **Detection confidence**: High

## LL-08 · Meta Pixel reports which videos a user watched

- **Phase**: 2
- **Region**: US
- **Law**: Video Privacy Protection Act, 18 U.S.C. §2710
- **Trap**: Pages that play video also load Meta Pixel, which sends the video title or URL alongside the viewer's Facebook identity.
- **Applies when**: Products that deliver video content, including courses and media sites.
- **Detection** (static, runtime): Find video players (video tags, Mux, Vimeo, YouTube embeds) on routes that also load Meta Pixel. At runtime, capture pixel payloads and look for video titles or URLs.
- **Fix** (full): Strip content identifiers from pixel events on video routes or drop the pixel there; add a standalone VPPA consent if the pixel must stay.
- **Exposure**: $2,500 per person in liquidated damages, which is why class actions follow.
- **Detection confidence**: Medium; courts disagree on who counts as a video provider

## LL-09 · Children's data with no age gate

- **Phase**: 2
- **Region**: US
- **Law**: COPPA, 15 U.S.C. §6501; 16 CFR Part 312 (2025 amendments)
- **Trap**: The product is aimed at kids, or asks for age, and collects personal data from under-13s without a neutral age screen or verifiable parental consent.
- **Applies when**: Child-directed services, or actual knowledge of under-13 users. General-audience apps that never ask age are mostly out of scope. Intake decides.
- **Detection** (intake, static): Intake asks about audience. Statically, find signup forms with `dob`, `age` or `birthday` fields, age checks that let users retry after entering a young age, and ad SDKs on child-directed routes.
- **Fix** (partial): Neutral age screen with no default and no hint of the cutoff, block and remember under-13 attempts, parental-consent flow scaffold, ad SDKs disabled for flagged users.
- **Exposure**: Up to $53,088 per violation (2025 cap). Epic Games settled for $275M in 2022.
- **Detection confidence**: Medium

## LL-10 · Accounts can be created but not deleted

- **Phase**: 2
- **Region**: App stores, EU
- **Law**: App Store Review Guideline 5.1.1(v); Google Play account deletion policy; GDPR Art. 17
- **Trap**: The app has signup but no in-app way to delete the account and its data. Deleting only the auth record counts as a miss.
- **Applies when**: Any iOS or Android app with accounts. Google Play also wants a web deletion link.
- **Detection** (static): Auth present (Supabase, Firebase, Clerk, NextAuth) but no delete-user endpoint or screen. Trace whether deletion also removes rows tied to the user.
- **Fix** (full): Delete-account screen, API route calling the auth provider's delete, cascade job for user data, public web page for Play.
- **Exposure**: App rejection or removal; GDPR erasure complaints.
- **Detection confidence**: High

## LL-11 · Privacy policy doesn't match the code

- **Phase**: 3
- **Region**: US, EU
- **Law**: CalOPPA, Bus. & Prof. Code §22575; FTC Act §5; GDPR Art. 13
- **Trap**: The policy omits data the app collects or third parties it sends data to, such as Sentry, OpenAI or Mixpanel.
- **Applies when**: Nearly every product.
- **Detection** (static): Build an inventory of form fields, SDKs and outbound API hosts. The user's coding agent compares it with the policy text and lists what's missing.
- **Fix** (partial): Generated "Data we collect" and "Service providers" sections for the owner to review. Not a full policy.
- **Exposure**: FTC deception orders; CalOPPA claims brought through unfair-competition law, often pleaded at $2,500 per violation.
- **Detection confidence**: Medium

## LL-12 · Signup and checkout fail basic accessibility

- **Phase**: 3
- **Region**: US, EU
- **Law**: ADA Title III; California Unruh Civil Rights Act §52; European Accessibility Act (applies since 28 Jun 2025)
- **Trap**: Missing alt text, unlabelled inputs, low contrast or keyboard traps on the flows that matter.
- **Applies when**: US consumer-facing sites. The EAA covers e-commerce, banking, e-books and transport; microenterprises are exempt for services.
- **Detection** (runtime, static): axe-core on signup, checkout and pricing. `eslint-plugin-jsx-a11y` rules on the repo.
- **Fix** (partial): Auto-fixes for labels, roles and contrast tokens; alt text flagged for a human to write.
- **Exposure**: Unruh sets a $4,000 minimum per violation. ADA demand letters are common and usually settle with fees. EAA penalties vary by member state.
- **Detection confidence**: Medium; automated checks catch only part of the problem

## LL-13 · Health data sent to ad pixels

- **Phase**: 3
- **Region**: US
- **Law**: Washington My Health My Data Act, RCW 19.373; FTC Health Breach Notification Rule
- **Trap**: Symptoms, cycles, mood or similar data is collected and pages that handle it also load ad or analytics pixels, with no separate consent.
- **Applies when**: Health, fitness, femtech and therapy-adjacent apps. MHMDA gives consumers a private right of action.
- **Detection** (intake, static, runtime): Health terms in form fields and DB columns; ad and analytics SDKs on those routes; pixel payloads at runtime.
- **Fix** (partial): Remove pixels from health routes, separate consent screen for health data, consumer health data privacy policy linked from the homepage.
- **Exposure**: Private suits under Washington's Consumer Protection Act; FTC civil penalties. GoodRx paid $1.5M in 2023.
- **Detection confidence**: Medium

## LL-14 · Marketing SMS without written consent

- **Phase**: 3
- **Region**: US
- **Law**: TCPA, 47 U.S.C. §227
- **Trap**: Promo texts go to numbers collected without express written consent language, with no STOP handling or consent record.
- **Applies when**: SMS marketing to US numbers.
- **Detection** (static): Find Twilio, Vonage, Plivo or MessageBird sends in marketing flows; phone fields without consent text; no inbound webhook for STOP; no stored consent timestamp.
- **Fix** (full): Consent checkbox with disclosure, consent log table, STOP and HELP webhook, quiet-hours guard.
- **Exposure**: $500 per message, up to $1,500 if willful.
- **Detection confidence**: Medium

## LL-15 · No DPDP consent notice for Indian users

- **Phase**: 3
- **Region**: India
- **Law**: Digital Personal Data Protection Act 2023; DPDP Rules 2025
- **Trap**: Personal data is collected from Indian users without a standalone notice listing items and purposes, a way to withdraw consent as easily as giving it, or a grievance contact.
- **Applies when**: Any processing of Indian users' digital personal data. Most obligations phase in over 18 months from the Rules' notification in late 2025.
- **Detection** (intake, static, runtime): Signup and consent flows lacking an itemised notice; no withdraw-consent control in settings; no grievance contact page.
- **Fix** (partial): Consent notice component with data items and purposes, withdraw-consent toggle, grievance officer contact page.
- **Exposure**: Up to ₹250 crore for failing security safeguards, ₹200 crore for children's-data failures.
- **Detection confidence**: Low to medium until the phase-in completes
