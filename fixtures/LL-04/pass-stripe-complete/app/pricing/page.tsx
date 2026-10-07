'use client';

import { useState } from 'react';

export default function Pricing() {
  const [agreed, setAgreed] = useState(false);
  async function subscribe() {
    const res = await fetch('/api/checkout', { method: 'POST', body: JSON.stringify({ renewalConsentAt: new Date().toISOString() }) });
    window.location.href = (await res.json()).url;
  }
  return (
    <main>
      <h1>Pro</h1>
      <p>$29/mo. Everything you need to ship.</p>
      <p>Renews automatically every month at $29 until you cancel. Cancel anytime in Settings, Billing.</p>
      <label>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I agree that my subscription renews automatically until I cancel.
      </label>
      <button onClick={subscribe} disabled={!agreed}>Subscribe</button>
    </main>
  );
}
