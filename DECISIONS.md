# Decisions

One line per non-obvious choice, and why.

## Product

- **No free tier.** Without a valid licence key the tool will not run (milestone 5). This replaces the brief's keyless tier, which withheld evidence and fix guidance; decided by the owner on 2026-10-06.
- **Intake gaps become `needs_intake`, not silence.** With no config, or an unanswered question, detectors still run and their findings carry the exact intake question. That way the owner sees the risk and what to answer.
- **Only `open` findings fail the CLI (exit 1).** `needs_intake` and `needs_judgment` are questions, not problems, and exit 0. Exit 2 means the scan could not run.
- **`euUkVisitors: true` counts as yes for EU-scoped rules.** The rulebook's intake asks one combined EU/UK question, so it cannot separate a UK-only site. Flagged in LEGAL_REVIEW.md.
- **A country list never implies "no".** `countries` containing an EU/EEA code means yes; a list without one stays "unknown" until `euUkVisitors` is answered, because EU visitors reach most public sites anyway.
- **Added an intake field, `dmcaAgentRegistered`.** LL-05 says intake asks about Copyright Office registration, but the rulebook's intake list has no such question.
- **"Serves the US" will count as "has California visitors"** for LL-02/03/04 (milestone 2). The intake asks countries, not states.
- **A third exposure label, `consequence`.** LL-04's exposure is neither a statutory maximum nor a named case.
- **`sources` and `lastReviewed` are left empty.** The rulebook has neither, and the brief says not to extend legal text from memory.

## Engine

- **`detectRuntime(site: SiteCapture)` instead of a live Playwright page.** The crawler records once and every rule is a pure function of the recording. Rules are easy to test, and the CLI and API share one crawler.
- **The crawler never clicks, types, scrolls or submits**, so everything recorded happened before consent, by construction.
- **Finding id = hash(rule id, file or page path).** Line numbers are left out so that edits elsewhere in the file don't change the id.
- **One finding per file per rule**, listing every location as evidence, so an agent fixes a file in one pass.
- **A detector that throws is isolated.** Its error is shown in the report and the other rules still run.
- **Rule data (legal.yaml, fix.yaml) is imported as `?raw` text and validated with zod at load.** A broken data file fails loudly. A small tsup plugin inlines the files into the bundle.
- **Files skipped by every static rule:** `.gitignore`d paths (nested files are respected), `node_modules` and build output, files over 1 MB, tests, stories, fixtures, `test-*`/`*_test` scripts, and minified bundles. None of them reach a visitor's browser.
- **.vue/.svelte/.astro files are scanned as HTML text.** Their `<link>` and `<style>` blocks are covered; their script blocks are not parsed.

## LL-01

- **A font URL needs a scheme or a leading `//`.** That way prose like "we stopped using fonts.googleapis.com" is not read as a load.
- **In code, a bare host with no font path (for example in a CSP header) is ignored.** Only `/css`, `/css2` and `/icon` on googleapis, and `/s/` on gstatic, count.
- **`preconnect` is medium confidence.** It opens a connection that reveals the visitor's IP even when nothing is downloaded. **`dns-prefetch` is ignored**: it only resolves the name, so the visitor's IP never reaches Google.
- **A font URL in a JS string whose use we can't see is low confidence.** It becomes medium when the same file calls `document.createElement('link')`. Found while scanning real repos: a URL list in a test script produced a false finding.
- **HTML and CSS inside JS strings go through the HTML and CSS scanners.** Print windows, server-rendered pages and CSS-in-JS get the same precision as real files.
- **webfontloader is detected by its `google:` config.** It loads from Google without the host ever appearing in the source.

## Tooling

- **pnpm 10.34.6, pinned in `packageManager`.** The installed corepack cannot run pnpm 12.
- **TypeScript 6.0.3 for the compiler API.** TypeScript 7's JavaScript API is still published as `unstable`. Syntax trees only (`createSourceFile`), no Program or type checker, and no ts-morph, because nothing needs type information.
- **Playwright is an optional dependency of the CLI**, external to the bundle and loaded with a dynamic import, so `npx legal-lint` installs fast. URL scans print an install hint when it is missing.
- **The crawler's user agent identifies the tool:** `Mozilla/5.0 (compatible; LegalLint/<version>; +https://www.npmjs.com/package/legal-lint)`.
- **Runtime tests never touch the network.** Fixtures are served from 127.0.0.1, and every other request is still recorded but answered locally with an empty response.
