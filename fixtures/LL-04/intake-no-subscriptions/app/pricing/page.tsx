'use client';

export default function Pricing() {
  async function subscribe() {
    const res = await fetch('/api/checkout', { method: 'POST' });
    window.location.href = (await res.json()).url;
  }
  return (
    <main>
      <h1>Pro</h1>
      <p>$29/mo. Everything you need to ship.</p>
      <button onClick={subscribe}>Subscribe</button>
    </main>
  );
}
