import "server-only";

import { Resend } from "resend";

import { env } from "./env";

// Sentinel value used in non-production .env to allow a successful local build
// without a real Resend key. Treated as "not configured" at runtime.
export const RESEND_PLACEHOLDER = "re_local_dev_placeholder";

// Thin wrapper around Resend. Sends plain, branded emails for the verification flow.
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!env.resendApiKey || env.resendApiKey === RESEND_PLACEHOLDER) {
    // No real Resend key configured (e.g. local build). Fail loudly so the
    // caller can surface a helpful message, rather than leaking the raw error.
    throw new Error("RESEND_API_KEY is not configured — cannot send email");
  }
  const resend = new Resend(env.resendApiKey);
  const { error } = await resend.emails.send({
    from: env.emailFrom,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

export function verificationEmailHtml(code: string): string {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
      <p style="font-size:20px;font-weight:700;margin:0 0 16px;color:#111827;">Welcome to Vantra</p>
      <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
        Your verification code is:
      </p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;color:#4f46e5;margin:0 0 16px;">
        ${code}
      </p>
      <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
        Enter this code on the verification screen to activate your account.
        It expires in 15 minutes. If you didn't request this, you can ignore this email.
      </p>
    </div>
  </body>
</html>`;
}

/** Shared shell for the wallet/payment emails. */
function walletEmailHtml(title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
      <p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;margin:0 0 8px;">Vantra Wallet</p>
      <p style="font-size:20px;font-weight:700;margin:0 0 16px;color:#111827;">${title}</p>
      ${body}
    </div>
  </body>
</html>`;
}

/** Sent the moment a customer submits a tx hash — before any admin action. */
export function walletPendingHtml(amountUsd: number, method: string): string {
  return walletEmailHtml(
    "Payment received — pending confirmation",
    `<p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
       Thanks for your ${method} payment of <strong>$${amountUsd}</strong>.
       We've received your transaction hash and it's now being reviewed by our
       team. This usually takes a short while.
     </p>
     <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
       Once it's confirmed, the amount will be credited to your wallet balance and
       you'll receive a confirmation email.
     </p>
     <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
       No action is needed from you right now.
     </p>`,
  );
}

/** Sent after an admin confirms a payment and credits the wallet. */
export function walletCreditedHtml(amountUsd: number): string {
  return walletEmailHtml(
    "Your wallet has been credited",
    `<p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
       Your payment has been confirmed and <strong>$${amountUsd}</strong> has been
       credited to your Vantra wallet balance.
     </p>
     <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
       You can now spend this balance on Premium for any of your organizations
       from the Billing settings page.
     </p>
     <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
       If you believe this is a mistake, please contact support.
     </p>`,
  );
}

/** Sent when an admin rejects a payment (carries the admin's message verbatim). */
export function walletRejectedHtml(message: string): string {
  return walletEmailHtml(
    "Your payment could not be confirmed",
    `<p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
       Your payment could not be confirmed and no amount was credited to your wallet.
     </p>
     <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
       Our team's note:
     </p>
     <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e5e7eb;color:#374151;font-size:14px;">
       ${message}
     </blockquote>
     <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
       If you have questions, please reply to this email or contact support.
     </p>`,
  );
}

/** Internal ops alert sent to the admin email address on a pending review. */
export function adminAlertHtml(opts: {
  userEmail: string;
  amountUsd: number;
  method: string;
  txHash: string;
  walletAddress: string;
}): string {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
      <p style="font-size:20px;font-weight:700;margin:0 0 16px;color:#111827;">⚠️ Payment awaiting review</p>
      <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 12px;">
        A customer submitted a manual crypto payment and it needs your review:
      </p>
      <table style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px;">
        <tr><td style="padding:2px 12px 2px 0;font-weight:600;">User</td><td>${opts.userEmail}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600;">Amount</td><td>$${opts.amountUsd}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600;">Method</td><td>${opts.method}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600;">Tx hash</td><td style="word-break:break-all;">${opts.txHash}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;font-weight:600;">Address</td><td style="word-break:break-all;">${opts.walletAddress}</td></tr>
      </table>
      <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
        Review it in the admin panel: /admin101/payments
      </p>
    </div>
  </body>
</html>`;
}