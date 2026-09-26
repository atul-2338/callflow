import CheckoutReturn from "@/components/onboarding/CheckoutReturn";

export const metadata = {
  title: "Confirming your payment — CallFlow",
  description: "We are verifying your subscription with Dodo Payments.",
  robots: { index: false, follow: false },
};

/**
 * `DODO_PAYMENTS_RETURN_URL` target. Deliberately not a "thank you" page: it
 * shows the state the verified webhook produced, so a bookmarked or forged
 * `?status=success` redirect can never look like a paid account.
 */
export default function CheckoutReturnPage() {
  return <CheckoutReturn />;
}
