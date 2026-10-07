'use client';

export default function Pricing() {
  async function subscribe() {
    const res = await fetch('/api/checkout', { method: 'POST' });
    window.location.href = (await res.json()).url;
  }
  return (
    <main>
      <h1>Pro</h1>
      <p>Lifetime licence, $99 one-time payment.</p>
      <button onClick={subscribe}>Buy now</button>
    </main>
  );
}
