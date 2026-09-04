import "server-only";

import { db } from "./db";

/**
 * Records one API-route failure for the admin Errors tab. Mirrors
 * lib/notification-log.ts's contract exactly: never throws — a DB hiccup here
 * must never change the response the route is already returning to the client.
 * The `errorMessage` / `stack` store the REAL error (err.message / err.stack),
 * not the sanitized public message, so failures are diagnosable in
 * /admin101/errors instead of only scrolling away in console.log.
 */
export async function logApiError(input: {
  route: string;
  method: string;
  statusCode: number;
  error: unknown;
  userId?: string | null;
  // True when this is a "log-and-continue" failure — the route still returns
  // a 2xx to the client despite this error (e.g. a confirmation email failed
  // but the underlying operation succeeded). Defaults false: the normal case
  // is a failure that actually aborts the request with a matching error
  // status, which is what every pre-existing call site does.
  clientReceivedSuccess?: boolean;
}): Promise<void> {
  try {
    const message =
      input.error instanceof Error
        ? input.error.message
        : String(input.error ?? "Unknown error");
    const stack = input.error instanceof Error ? (input.error.stack ?? null) : null;
    await db.apiErrorLog.create({
      data: {
        route: input.route,
        method: input.method,
        statusCode: input.statusCode,
        errorMessage: message.slice(0, 2000),
        stack: stack ? stack.slice(0, 8000) : null,
        userId: input.userId ?? null,
        clientReceivedSuccess: input.clientReceivedSuccess ?? false,
      },
    });
  } catch (err) {
    console.error("logApiError failed:", err);
  }
}