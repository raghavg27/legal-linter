import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const { customerId } = await request.json();
  const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: 'https://acme.com/settings' });
  return Response.json({ url: portal.url });
}
