import PolicyPage, { CardLink, Section } from "@/components/marketing/PolicyPage";

export const metadata = {
  title: "Refund Policy · CallFlow",
  description:
    "How CallFlow refunds work: 3-day free trial with nothing charged, cancel anytime before renewal, and a 14-day money-back guarantee on your first paid month.",
};

const UPDATED = "September 14, 2026";

export default function RefundPolicyPage() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Refund Policy"
      intro="CallFlow is month to month, there are no contracts, and we would rather fix the problem than argue about a refund. Here is exactly what you can get your money back for, and how to ask."
      updated={UPDATED}
    >
      <Section heading="1. The short version">
        <p>
          During your 3-day free trial you are charged <b className="text-ink">
            $0
          </b>{" "}
          — cancel any time in those first three days and nothing will ever be
          billed to you.
        </p>
        <p>
          After you become a paying customer, you can cancel any time and stop
          all future charges. If something is not working, email{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>{" "}
          and we will make it right.
        </p>
      </Section>

      <Section heading="2. Free trial — no charge to refund">
        <p>
          Signup starts a 3-day free trial. No payment is taken at signup, and no
          charge is scheduled until day 4. If you cancel on or before day 3, your
          subscription ends and you are billed nothing.
        </p>
        <p>
          If you were charged before the trial period actually ended, that is our
          mistake — tell us and we will refund the charge in full, promptly.
        </p>
      </Section>

      <Section heading="3. 14-day money-back guarantee on your first payment">
        <p>
          If CallFlow is not a fit for your business, email{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>{" "}
          within <b className="text-ink">14 days</b> of your first $49 monthly
          charge and we will refund that payment in full. No survey, no
          retention call, no conditions beyond asking inside the window.
        </p>
      </Section>

      <Section heading="4. Later months and mid-cycle cancellation">
        <p>
          For charges after your first month, refunds are handled case by case
          and are not guaranteed. Two situations we will normally refund or
          credit:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            A duplicate or clearly erroneous charge (for example, being billed
            twice in one month).
          </li>
          <li>
            A sustained outage on our side that stopped missed calls from being
            answered, where you had a paid subscription at the time.
          </li>
        </ul>
        <p>
          Otherwise, cancelling stops the next billing date rather than refunding
          the one already paid for — you keep full access through the end of the
          month you paid for. We do not issue partial-month credits for
          subscriptions that run past their current billing period.
        </p>
      </Section>

      <Section heading="5. How to request a refund">
        <p>
          Email <CardLink href="mailto:atul@callflow.biz">
            atul@callflow.biz
          </CardLink>{" "}
          from the address on your CallFlow account and include:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>The date and amount of the charge (check your bank statement).</li>
          <li>The last 4 digits of the card charged, for identification.</li>
          <li>A one-line reason — genuinely helpful, not a hurdle.</li>
        </ul>
        <p>
          We acknowledge refund requests within one business day. Approved
          refunds are returned to the original payment method; card refunds
          typically appear on your statement within 5–10 business days, depending
          on your bank.
        </p>
      </Section>

      <Section heading="6. Third-party charges and disputes">
        <p>
          Your plan fee covers CallFlow. Charges that come directly from your
          phone carrier for forwarding calls, or from your own number provider,
          are not ours to refund — they are billed by them under their terms.
        </p>
        <p>
          We ask that you contact us before opening a chargeback dispute. Almost
          every dispute we see is a misunderstanding about a renewal date, and we
          would much rather refund you than fight a bank. That said, you always
          retain the right to dispute a charge with your card issuer.
        </p>
      </Section>

      <Section heading="7. Questions">
        <p>
          Billing and refund questions go to{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>.
          The terms that govern your subscription overall are in our{" "}
          <CardLink href="/terms">Terms of Service</CardLink>, and how we handle
          your data is in our <CardLink href="/privacy">Privacy Policy</CardLink>.
        </p>
      </Section>
    </PolicyPage>
  );
}
