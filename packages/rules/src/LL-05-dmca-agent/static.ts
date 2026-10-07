import {
  fileKind,
  isNonShippingFile,
  listRoutes,
  markupText,
  scriptText,
  type DetectContext,
  type RawFinding,
  type RepoIndex,
  type StaticEvidence,
} from '@legal-lint/core';
import { findUploadHandlers } from './uploads.ts';

const PAGE_FILE = /\.(tsx|jsx|ts|js|mdx|md|html?|astro|vue|svelte)$/;
const AGENT = /\b(designated|copyright|dmca)\s+agent\b/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

interface DmcaPage {
  file: string;
  hasContact: boolean;
}

async function readable(repo: RepoIndex, file: string): Promise<{ text: string; raw: string }> {
  const raw = await repo.read(file);
  const kind = fileKind(file);
  if (kind === 'script') {
    const sf = await repo.sourceFile(file);
    return { text: sf ? scriptText(sf) : raw, raw };
  }
  if (kind === 'markup') return { text: markupText(raw), raw };
  return { text: raw, raw };
}

/**
 * A DMCA page is a page or content file with dmca/copyright in its path. It is
 * also a page that refers to a DMCA, copyright or designated agent. A route name
 * is not necessary: policies are frequently in /legal or in Markdown content.
 */
async function findDmcaPages(repo: RepoIndex): Promise<DmcaPage[]> {
  const pageFiles = new Set((await listRoutes(repo)).filter((r) => r.kind === 'page').map((r) => r.file));
  const pages: DmcaPage[] = [];
  for (const file of repo.files) {
    if (!PAGE_FILE.test(file) || isNonShippingFile(file)) continue;
    const named = /(dmca|copyright)/i.test(file);
    if (!named && !pageFiles.has(file) && !/\.mdx?$/.test(file)) continue;
    const { text, raw } = await readable(repo, file);
    if (!named && !(/\bDMCA\b/.test(text) && AGENT.test(text))) continue;
    pages.push({ file, hasContact: EMAIL.test(text) || /mailto:/i.test(raw) });
  }
  return pages.sort((a, b) => Number(b.hasContact) - Number(a.hasContact));
}

const SAFE_HARBOR = "can cost the app its DMCA safe harbor for what users upload.";

export async function detectStatic(repo: RepoIndex, ctx: DetectContext): Promise<RawFinding[]> {
  const uploads = (await findUploadHandlers(repo)).slice(0, 5);
  // Without upload code, only a "yes" from the owner is a reason for a finding. If not, each repo would get a question.
  if (uploads.length === 0 && ctx.intake?.hostsPublicUploads !== true) return [];
  const [page] = await findDmcaPages(repo);

  if (!page) {
    return [
      {
        key: 'dmca-page',
        // The intake says that uploads are hosted publicly. If the scan also sees the upload code, this is certain.
        confidence: uploads.length > 0 ? 'high' : 'medium',
        evidence: [
          ...uploads,
          {
            kind: 'absence',
            looked: ['pages and content files named dmca or copyright', 'pages mentioning a DMCA, copyright or designated agent'],
            observed: 'No DMCA or copyright page naming a designated agent found',
          },
        ],
        explanation:
          (uploads.length > 0
            ? 'Users can upload content that the app hosts, and the repo has no DMCA or copyright page naming a designated agent. '
            : 'The intake says the product hosts user uploads publicly, and the repo has no DMCA or copyright page naming a designated agent. ') +
          `Without a designated agent, the owner ${SAFE_HARBOR}`,
      },
    ];
  }

  const pageEvidence: StaticEvidence = {
    kind: 'static',
    file: page.file,
    startLine: 1,
    endLine: 1,
    snippet: page.file,
    observed: page.hasContact ? 'DMCA or copyright page with agent contact details' : 'DMCA or copyright page',
  };

  if (!page.hasContact) {
    return [
      {
        key: 'dmca-contact',
        confidence: 'medium',
        evidence: [
          pageEvidence,
          { kind: 'absence', looked: [page.file], observed: 'No contact email for the designated agent on the DMCA page' },
        ],
        explanation: `A DMCA or copyright page exists but lists no contact details for a designated agent. An agent that rights holders cannot reach ${SAFE_HARBOR}`,
      },
    ];
  }

  const registered = ctx.intake?.dmcaAgentRegistered;
  if (registered === true) return [];
  return [
    {
      key: 'dmca-registration',
      confidence: registered === false ? 'high' : 'medium',
      evidence: [pageEvidence],
      explanation:
        registered === false
          ? `A DMCA page lists an agent, but the intake says the agent is not registered with the US Copyright Office. An agent that is listed but not registered ${SAFE_HARBOR}`
          : `A DMCA page lists an agent, but it is not confirmed that the agent is registered with the US Copyright Office. An agent that is listed but not registered ${SAFE_HARBOR}`,
      needsIntake: registered === undefined ? ['dmcaAgentRegistered'] : undefined,
    },
  ];
}
