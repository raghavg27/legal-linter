'use client';

import Hotjar from '@hotjar/browser';
import { useEffect, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    Hotjar.init(3912345, 6);
  }, []);
  return <>{children}</>;
}
