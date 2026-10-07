export default function SubscriptionConfirmation({ price }: { price: string }) {
  return (
    <div>
      <p>Your Pro subscription has started at {price} per month.</p>
      <p>It renews automatically every month until you cancel. You can cancel anytime in Settings, Billing.</p>
    </div>
  );
}
