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
      },
    });
  } catch (err) {
    console.error("logApiError failed:", err);
  }
}