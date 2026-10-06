'use client';

import posthog from 'posthog-js';

export function ConsentBanner() {
  return (
    <div role="dialog">
      <p>We record how you use this site (clicks, scrolling, page changes) to improve it, only if you agree.</p>
      <button onClick={() => posthog.opt_in_capturing()}>Accept</button>
    </div>
  );
}
