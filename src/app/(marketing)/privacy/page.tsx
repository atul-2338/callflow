import PolicyPage, { CardLink, Section } from "@/components/marketing/PolicyPage";

export const metadata = {
  title: "Privacy Policy · CallFlow",
  description:
    "What CallFlow collects, why, who processes it (Plivo, Dograh, Firebase, Dodo Payments, Render), how long we keep it, and how to exercise your rights.",
};

const UPDATED = "September 14, 2026";

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="CallFlow sits in the middle of your business's phone calls, so we hold genuinely sensitive material: who called you, when, and what they said. This page spells out exactly what we collect, who else touches it, and how to get it deleted."
      updated={UPDATED}
    >
      <Section heading="1. Who this covers">
        <p>
          Two groups: <b className="text-ink">subscribers</b> (the businesses that
          sign up for CallFlow) and <b className="text-ink">callers</b> (members of
          the public whose missed calls are answered by the service). Both are
          covered here.
        </p>
        <p>
          CallFlow is operated from the United States. Data questions, deletion
          requests, and complaints all go to{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>.
        </p>
      </Section>

      <Section heading="2. What we collect from subscribers">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Account details: business name, your name, email address, phone
            number, and your business&apos;s location and opening hours.
          </li>
          <li>
            Setup details: the number you forward from, the dedicated number we
            provision for you, and the message/FAQ content you ask the AI to use.
          </li>
          <li>
            A mobile push token for your device, so we can notify you when a call
            ends.
          </li>
          <li>
            Billing metadata: plan, trial start date, invoice and payment status.
            Card numbers are handled by our payment provider — we never see or
            store full card details.
          </li>
          <li>
            Support correspondence you send us by email.
          </li>
        </ul>
      </Section>

      <Section heading="3. What we collect about callers">
        <p>
          For each call forwarded to CallFlow we process the caller&apos;s phone
          number, the time and duration of the call, the audio of the
          conversation as answered by the AI receptionist, and the resulting
          written transcript and any appointment or message details the caller
          volunteers.
        </p>
        <p>
          We do not ask callers for personal information beyond what is needed to
          take a message or book an appointment, and we do not build marketing
          profiles of people who call a business.
        </p>
      </Section>

      <Section heading="4. How we use it">
        <ul className="list-disc space-y-2 pl-5">
          <li>To answer your missed calls and produce transcripts and booking records.</li>
          <li>To send you notifications, the call log, and billing invoices.</li>
          <li>To keep the service running: abuse prevention, troubleshooting, and error diagnosis.</li>
          <li>To respond to you when you contact support.</li>
          <li>To meet legal and accounting obligations (tax records, lawful requests).</li>
        </ul>
        <p>
          We do not sell personal information, and we do not use your call content
          to train third-party foundation models.
        </p>
      </Section>

      <Section heading="5. The providers who process data for us">
        <p>
          CallFlow is built on specialist providers, each of which handles a slice
          of the data under written processing terms:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b className="text-ink">Plivo</b> — provisions your dedicated number
            and carries the call audio and call-detail records.
          </li>
          <li>
            <b className="text-ink">Dograh</b> — runs the AI voice agent,
            including speech recognition and transcript generation.
          </li>
          <li>
            <b className="text-ink">Google Firebase Cloud Messaging</b> — delivers
            push notifications to your device.
          </li>
          <li>
            <b className="text-ink">Dodo Payments</b> — hosts checkout and
            processes card payments, and is the merchant of record for
            subscription billing.
          </li>
          <li>
            <b className="text-ink">Render</b> — hosts our application and stores
            your account data and call history in our database.
          </li>
        </ul>
        <p>
          Where a provider may transfer data outside your region, we rely on their
          standard contractual safeguards.
        </p>
      </Section>

      <Section heading="6. Cookies and local storage">
        <p>
          Our marketing and policy pages do not set advertising or tracking
          cookies, and they run no third-party analytics scripts. Inside the
          signed-in product, a small amount of information is stored in your
          browser&apos;s local storage so the app can remember your device and
          restore your session preferences. You can clear it at any time through
          your browser settings; doing so will simply ask you to reconnect.
        </p>
      </Section>

      <Section heading="7. How long we keep things">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Account and call data: kept while your subscription is active. Call
            history and transcripts are available for 12 months of rolling
            history; you can delete individual call records yourself at any time.
          </li>
          <li>
            On cancellation or closure: we delete your account contents within 30
            days, except billing records we are required to keep for tax and audit
            purposes (7 years).
          </li>
          <li>
            Call audio used to produce a transcript: retained only as long as
            needed to deliver and debug the transcript, then removed.
          </li>
          <li>
            Support email: kept for as long as it is relevant to your account.
          </li>
        </ul>
      </Section>

      <Section heading="8. How we protect it">
        <p>
          All traffic is served over HTTPS. Access to production data is limited
          to named operators using credentials that are not shared, and secrets
          for our providers are held in environment variables rather than in the
          codebase. Backups of the database are taken on a regular schedule. No
          system is perfectly secure, so we also keep collection minimal — the
          least we need to answer your calls is the most we take.
        </p>
      </Section>

      <Section heading="9. Your rights">
        <p>
          Depending on where you live, you can ask us to: access the personal
          information we hold about you; correct it; delete it; give you a copy in
          a portable format; restrict or object to particular processing; or honor
          a do-not-sell / do-not-share request under state privacy laws such as the
          CCPA/CPRA. Because we do not sell personal information, there is nothing
          to opt out of on that front.
        </p>
        <p>
          To make a request — including on behalf of someone whose call you are
          asking about — email{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>{" "}
          and we will respond within 30 days. We may need to verify who you are
          before answering. You also have the right to complain to a data
          protection authority.
        </p>
      </Section>

      <Section heading="10. Children">
        <p>
          CallFlow is a business tool for adult-owned local businesses and is not
          directed to children. We do not knowingly collect information from anyone
          under 16. If you believe a child&apos;s information reached us through a
          forwarded call, email us and we will remove it.
        </p>
      </Section>

      <Section heading="11. Changes to this policy">
        <p>
          If we change this policy materially we will update the date above and,
          where the change affects how your data is handled, email you before it
          takes effect. The current version is always the one published at{" "}
          <CardLink href="/privacy">callflow.biz/privacy</CardLink>.
        </p>
      </Section>

      <Section heading="12. Contact">
        <p>
          Data protection and privacy questions:{" "}
          <CardLink href="mailto:atul@callflow.biz">atul@callflow.biz</CardLink>.
          Related documents: <CardLink href="/terms">Terms of Service</CardLink>,{" "}
          <CardLink href="/refund-policy">Refund Policy</CardLink>,{" "}
          <CardLink href="/pricing">Pricing</CardLink>.
        </p>
      </Section>
    </PolicyPage>
  );
}

