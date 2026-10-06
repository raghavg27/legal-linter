'use client';

import Hotjar from '@hotjar/browser';
import { useEffect, type ReactNode } from 'react';
import { ConsentBanner, useConsent } from './consent';

export function Providers({ children }: { children: ReactNode }) {
  const { analyticsAllowed } = useConsent();
  useEffect(() => {
    if (!analyticsAllowed) return;
    Hotjar.init(3912345, 6);
  }, [analyticsAllowed]);
  return (
    <>
      {children}
      <ConsentBanner />
    </>
  );
}
