import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <Link href="/" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
        ← Back to Vantra
      </Link>
      <h1 className="mt-6 text-3xl font-bold text-fg">Terms of Use</h1>
      <p className="mt-2 text-sm text-fg-muted">Last updated: [DATE]</p>

      <div className="prose prose-sm mt-8 max-w-none text-fg [&_h2]:text-fg [&_strong]:text-fg">
        <p>
          These Terms of Use (&quot;Terms&quot;) govern your access to and use of Vantra
          (&quot;Service&quot;, &quot;we&quot;, &quot;us&quot;), a remote monitoring and
          management platform. By creating an account, you agree to these Terms. If you
          do not agree, do not use the Service.
        </p>

        <h2>1. Eligibility and account responsibility</h2>
        <p>
          You must be legally able to enter a binding agreement to use the Service. You
          are responsible for maintaining the confidentiality of your account credentials
          and for all activity that occurs under your account.
        </p>

        <h2>2. Authorized use only</h2>
        <p>
          You may only enroll, monitor, or remotely access devices that you own or have
          explicit, documented authorization to manage. You must not use the Service to:
        </p>
        <ul>
          <li>Access, monitor, or control any device without the owner&apos;s consent;</li>
          <li>Distribute malware, ransomware, or any other malicious software;</li>
          <li>
            Circumvent, disable, or interfere with any device&apos;s security controls
            except as part of legitimate administration of a device you are authorized to
            manage;
          </li>
          <li>Attempt to access another customer&apos;s account, devices, scripts, or support tickets;</li>
          <li>
            Use the Service to violate any applicable law, including computer-crime,
            privacy, or data-protection law in your jurisdiction;
          </li>
          <li>
            Circumvent device limits, plan restrictions, or rate limits through multiple
            accounts, automation, or any other means;
          </li>
          <li>Reverse-engineer, resell, or white-label the Service without our written permission.</li>
        </ul>
        <p>
          We may suspend or terminate any account, without notice, that we reasonably
          believe is being used to violate this section.
        </p>

        <h2>3. Scripts and remote commands</h2>
        <p>
          The Service allows you to write, save, and execute scripts and remote commands
          against your own enrolled devices. You are solely responsible for the content
          and effect of any script or command you run. We do not review, endorse, or
          guarantee the safety of user-authored scripts.
        </p>

        <h2>4. Plans, billing, and payments</h2>
        <p>
          Some features require a paid Premium plan. Payments are processed via
          third-party Bitcoin/Lightning payment processors; we do not custody your funds
          or store payment credentials. Premium access is granted for the period paid for
          and does not renew automatically — you are responsible for renewing before
          expiry if you wish to retain uninterrupted access. Cryptocurrency payments are
          generally irreversible; refunds, where offered, are at our sole discretion and
          [REFUND POLICY — TO BE DEFINED].
        </p>

        <h2>5. Device caps and fair use</h2>
        <p>
          Free and Premium plans are subject to the device limits displayed in your
          dashboard at the time of use. We may adjust these limits, and may suspend
          accounts that attempt to exceed them through abuse of the signup or
          verification process (e.g. creating multiple accounts to bypass a single
          plan&apos;s limit).
        </p>

        <h2>6. Service availability</h2>
        <p>
          The Service is provided on an &quot;as is&quot; and &quot;as available&quot;
          basis. We do not guarantee uninterrupted or error-free operation and are not
          liable for any loss arising from downtime, data loss, or device
          unavailability.
        </p>

        <h2>7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Vantra and its operators are not liable
          for any indirect, incidental, special, or consequential damages arising from
          your use of the Service, including damages to devices you manage through it.
          Our total liability for any claim arising from the Service is limited to the
          amount you paid us in the 3 months preceding the claim.
        </p>

        <h2>8. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate your
          account for violation of these Terms, non-payment, or extended inactivity, with
          or without notice depending on severity.
        </p>

        <h2>9. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Service after
          a change takes effect constitutes acceptance of the revised Terms.
        </p>

        <h2>10. Governing law</h2>
        <p>[GOVERNING LAW / JURISDICTION — TO BE DEFINED]</p>

        <h2>11. Contact</h2>
        <p>Questions about these Terms can be sent via the Support section of your dashboard.</p>
      </div>
    </div>
  );
}
