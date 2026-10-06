'use client';

import { useEffect, useState } from 'react';

export function useConsent() {
  const [analyticsAllowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(localStorage.getItem('consent') === 'yes');
  }, []);
  return { analyticsAllowed };
}

export function ConsentBanner() {
  return (
    <div role="dialog">
      <p>We record how you use this site (clicks, scrolling, page changes) to improve it, only if you agree.</p>
      <button onClick={() => { localStorage.setItem('consent', 'yes'); location.reload(); }}>Accept</button>
    </div>
  );
}
