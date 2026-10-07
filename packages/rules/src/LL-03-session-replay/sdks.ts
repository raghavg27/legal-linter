export type SdkName = 'FullStory' | 'Hotjar' | 'LogRocket' | 'Microsoft Clarity' | 'PostHog';

export interface ReplaySdk {
  name: SdkName;
  /** npm packages with an init call that starts the recording. */
  packages: string[];
  /** Method names that start the SDK. The code calls them on the imported binding (or imports them directly). */
  initMethods: string[];
  /** Markers of the copy-paste snippet or the script URL of the vendor in HTML or inline scripts. */
  snippet: RegExp;
  /** Runtime: a request that contains recording data. */
  recording: (url: URL) => boolean;
  /** Runtime: the load of the replay script itself. */
  script: (url: URL) => boolean;
}

const host = (url: URL, pattern: RegExp) => pattern.test(url.hostname);

export const SDKS: ReplaySdk[] = [
  {
    name: 'FullStory',
    packages: ['@fullstory/browser', '@fullstory/react'],
    initMethods: ['init'],
    snippet: /edge\.fullstory\.com\/s\/fs\.js|window\[['"]_fs_org['"]\]|_fs_org\s*=/,
    recording: (u) => host(u, /(^|\.)rs\.fullstory\.com$/) && u.pathname.startsWith('/rec/'),
    script: (u) => host(u, /(^|\.)fullstory\.com$/) && /\/fs\.js$/.test(u.pathname),
  },
  {
    name: 'Hotjar',
    packages: ['@hotjar/browser', 'react-hotjar'],
    initMethods: ['init', 'initialize'],
    snippet: /static\.hotjar\.com\/c\/hotjar-|_hjSettings\s*=/,
    recording: (u) => host(u, /(^|\.)hotjar\.io$/) || (u.protocol.startsWith('ws') && host(u, /(^|\.)hotjar\.com$/)),
    script: (u) => host(u, /^static\.hotjar\.com$/),
  },
  {
    name: 'LogRocket',
    packages: ['logrocket'],
    initMethods: ['init'],
    snippet: /cdn\.(logrocket\.io|lr-ingest\.io|lr-in\.com|lgrckt-in\.com)/,
    recording: (u) => host(u, /^r\.(logrocket\.io|lr-ingest\.io|lr-in\.com|lgrckt-in\.com)$/),
    script: (u) => host(u, /^cdn\.(logrocket\.io|lr-ingest\.io|lr-in\.com|lgrckt-in\.com)$/),
  },
  {
    name: 'Microsoft Clarity',
    packages: ['@microsoft/clarity', 'react-microsoft-clarity'],
    initMethods: ['init'],
    snippet: /www\.clarity\.ms\/tag\//,
    recording: (u) => host(u, /(^|\.)clarity\.ms$/) && u.pathname.startsWith('/collect'),
    script: (u) => host(u, /(^|\.)clarity\.ms$/) && u.pathname.startsWith('/tag/'),
  },
  {
    name: 'PostHog',
    packages: ['posthog-js', 'posthog-js/react'],
    initMethods: ['init'],
    snippet: /posthog\.init\s*\(|assets\.i\.posthog\.com\/static\/array/,
    // /s/ contains session recordings. /e/ and /decide/ are plain analytics, which are not part of this rule.
    recording: (u) => host(u, /(^|\.)posthog\.com$/) && /^\/s\/?$/.test(u.pathname),
    script: (u) => host(u, /(^|\.)posthog\.com$/) && /\/static\/(lazy-)?recorder(-v2)?\.js/.test(u.pathname),
  },
];

/**
 * Names that show a consent decision: consent managers, banner callbacks and
 * consent state. If a name matches, the scan thinks that the code has a consent
 * gate and gives no finding. A missed finding costs less than a false alarm.
 */
export const CONSENT =
  /consent|cookie_?(accepted|choice|preferences?|banner)|accepted|opt(ed)?[_-]?in|gdpr|ccpa|(analytics|tracking|statistics|marketing|replay|recording)_?(allowed|enabled|accepted|granted|ok)|allow_?(tracking|analytics|recording)|cookiebot|onetrust|optanon|klaro|osano|usercentrics|termly|iubenda|didomi|axeptio/i;
