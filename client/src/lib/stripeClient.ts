import { loadStripe } from "@stripe/stripe-js";

const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();

export function getStripePromise(publicKey: string) {
  const normalizedKey = publicKey.trim();
  if (!normalizedKey) return null;
  const cached = stripePromiseCache.get(normalizedKey);
  if (cached) return cached;
  const promise = loadStripe(normalizedKey);
  stripePromiseCache.set(normalizedKey, promise);
  return promise;
}
