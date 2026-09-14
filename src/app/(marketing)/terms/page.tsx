import PolicyPage, { CardLink, Section } from "@/components/marketing/PolicyPage";

export const metadata = {
  title: "Terms of Service · CallFlow",
  description:
    "The terms that govern a CallFlow subscription: free trial, monthly billing, cancellation, acceptable use, call recording consent, and support.",
};

const UPDATED = "September 14, 2026";

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="These terms are the agreement between you (the business subscribing to CallFlow) and CallFlow. By creating an account or using the service, you accept them."
      updated={UPDATED}
    >
      <Section heading="1. What CallFlow is">
        <p>
          CallFlow is a subscription service that answers your business&apos;s
          missed calls with an AI receptionist. You forward calls you cannot take
          to a dedicated number we provision; our software answers, records a
          message or books an appointment, writes the call into your account
          history, and sends your phone a notification.
        </p>
        <p>
          CallFlow is a tool for handling your own business calls. It is not a
          replacement for emergency services, and it is not a call-blasting or
          outbound-marketing platform.
        </p>
      </Section>

      <Section heading="2. Your account">
        <p>
          You must give us accurate business and contact details, and keep them
          current. You are responsible for activity under your account and for
          keeping the credentials to it safe. Tell us promptly at{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>{" "}
          if you believe someone else has used your account.
        </p>
      </Section>

      <Section heading="3. Free trial, fees, and billing">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            New subscriptions start on a <b className="text-ink">3-day free
            trial</b>. Nothing is charged at signup.
          </li>
          <li>
            After the trial, the Solo plan costs{" "}
            <b className="text-ink">$49 per month</b>, billed in advance and
            recurring on the same date each month until you cancel.
          </li>
          <li>
            Payment is collected by our payment provider, Dodo Payments. Charges
            appear on your statement identifying our payment provider.
          </li>
          <li>
            If a payment fails, we will retry and may suspend the service until
            billing is back in good standing.
          </li>
          <li>
            Prices may change for new customers, and we will email you at least
            30 days before a price change affects your renewals.
          </li>
          <li>
            Applicable taxes, where required, are added at checkout or invoiced
            by our payment provider.
          </li>
        </ul>
      </Section>

      <Section heading="4. Cancellation and refunds">
        <p>
          You can cancel at any time from your account, or by emailing{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>.
          Cancellation stops future charges. Your service continues through the
          end of the billing period you already paid for. Refunds are governed by
          our <CardLink href="/refund-policy">Refund Policy</CardLink>, including
          the 14-day money-back guarantee on a first paid month.
        </p>
      </Section>

      <Section heading="5. Acceptable use">
        <p>You agree not to use CallFlow to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Answer calls for a business whose line of work is unlawful, or that
            is prohibited by our payment provider&apos;s rules.
          </li>
          <li>
            Deceive callers, impersonate a person or organization you are not, or
            hide that an AI assistant is answering the call when asked directly.
          </li>
          <li>
            Collect payment card numbers, government ID numbers, or health
            information that CallFlow is not configured or contracted to handle.
          </li>
          <li>
            Use the service as an outbound dialer, or to place calls to consumers
            without a lawful basis.
          </li>
          <li>
            Overload, probe, reverse-engineer, or resell the service without our
            written permission.
          </li>
        </ul>
        <p>
          We may suspend an account that breaches these terms or exposes us, our
          providers, or other customers to harm. Where we can, we will tell you
          first and give you a chance to fix it.
        </p>
      </Section>

      <Section heading="6. Call recording and caller consent">
        <p>
          Calls forwarded to CallFlow are answered and may be recorded and
          transcribed in order to deliver the service. Telephone call recording
          and AI-disclosure rules differ by state and country, and several US
          states require all-party consent to record.
        </p>
        <p>
          <b className="text-ink">You are responsible</b> for checking the rules
          that apply to your business and your callers, and for putting any
          required notice in place — for example in your carrier greeting or your
          own voicemail prompt — before forwarding calls to us.
        </p>
      </Section>
      <Section heading="7. Your content and ours">
        <p>
          The business details you enter and the call records, messages, and
          transcripts generated from your calls belong to you. You grant us the
          limited license we need to store them, show them to you, and deliver
          the service — nothing broader.
        </p>
        <p>
          CallFlow&apos;s software, design, and branding remain ours. You get a
          personal, non-transferable licence to use the service while your
          subscription is active.
        </p>
      </Section>

      <Section heading="8. Service levels and changes">
        <p>
          We aim for CallFlow to be available around the clock, because that is
          the point of it. We do not promise an uptime percentage, and the service
          may be interrupted by maintenance, provider outages (phone carriers and
          number providers are outside our control), or events beyond our
          reasonable control.
        </p>
        <p>
          We may add, change, or retire features. If we ever shut the service
          down for good, we will email you and refund the unused portion of any
          period you pre-paid.
        </p>
      </Section>

      <Section heading="9. Disclaimers">
        <p>
          The service is provided &quot;as is&quot;. To the maximum extent allowed
          by law, CallFlow makes no warranty that the AI receptionist will
          understand every caller, that transcripts will be error-free, or that
          any particular volume of booked jobs will result. Callers are members
          of the public, and how many of them call you is not something anyone can
          guarantee.
        </p>
      </Section>

      <Section heading="10. Limitation of liability">
        <p>
          We are not liable for indirect, incidental, or consequential damages —
          lost revenue, lost leads, or lost goodwill. Our total liability for
          claims arising from these terms is limited to the greater of the fees
          you paid us in the 12 months before the claim, or $100. Nothing here
          limits liability that cannot be limited under applicable law, including
          your statutory consumer rights.
        </p>
      </Section>

      <Section heading="11. Indemnity">
        <p>
          If you breach these terms, or use the service in a way that breaks the
          law or violates a caller&apos;s consent rights, and that causes a third
          party claim against us, you agree to cover our reasonable costs in
          dealing with it.
        </p>
      </Section>

      <Section heading="12. Changes to these terms">
        <p>
          We will post changes on this page and update the &quot;Last
          updated&quot; date above. For material changes affecting a paying
          subscription, we will email you at least 14 days ahead. Continuing to
          use CallFlow after a change takes effect means you accept it.
        </p>
      </Section>

      <Section heading="13. Governing law and contact">
        <p>
          These terms are governed by the laws of the State of Delaware, United
          States, without regard to conflict-of-law rules, and the parties submit
          to the state and federal courts located there. Nothing in this section
          deprives you of protections you cannot contractually waive in your home
          jurisdiction.
        </p>
        <p>
          Questions about these terms, or to request account closure:{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>.
          See also our <CardLink href="/pricing">pricing</CardLink>,{" "}
          <CardLink href="/refund-policy">Refund Policy</CardLink>, and{" "}
          <CardLink href="/privacy">Privacy Policy</CardLink>.
        </p>
      </Section>
    </PolicyPage>
  );
}
