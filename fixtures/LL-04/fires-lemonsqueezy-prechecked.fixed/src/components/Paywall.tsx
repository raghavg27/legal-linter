export function Paywall({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <section>
      <h2>Upgrade to Pro</h2>
      <p>$12 per month. Renews monthly until you cancel; cancel anytime from your account.</p>
      <label>
        <input type="checkbox" name="renewalConsent" required />
        I agree to the recurring charge.
      </label>
      <button onClick={onUpgrade}>Upgrade</button>
    </section>
  );
}
