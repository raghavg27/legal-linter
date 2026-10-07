import { createCheckout, getSubscription } from '@lemonsqueezy/lemonsqueezy.js';

export async function startCheckout(storeId: number, variantId: number) {
  const { data } = await createCheckout(storeId, variantId, { checkoutOptions: { embed: true } });
  return data?.data.attributes.url;
}

export async function portalUrl(subscriptionId: string) {
  const { data } = await getSubscription(subscriptionId);
  return data?.data.attributes.urls.customer_portal;
}
