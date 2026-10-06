'use client';

import { PostHogProvider } from 'posthog-js/react';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PostHogProvider
      apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}
      options={{ api_host: 'https://us.i.posthog.com', opt_out_capturing_by_default: true }}
    >
      {children}
    </PostHogProvider>
  );
}
