import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: process.env.STRIPE_PRO_PRICE!, quantity: 1 }],
    success_url: 'https://acme.com/welcome',
    cancel_url: 'https://acme.com/pricing',
  });
  return Response.json({ url: session.url });
}
