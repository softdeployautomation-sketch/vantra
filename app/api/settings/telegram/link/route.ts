import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session-user";
import { telegramLinkConfigured, telegramLinkUrl } from "@/lib/telegram";

const LINK_TTL_MS = 15 * 60 * 1000; // links expire after 15 minutes

// GET: current link status, polled by the client after opening the Telegram
// deep-link — the /start webhook flips telegramChatId server-side with no way
// to push that to an already-rendered Settings page, so the client polls this
// instead of requiring a manual reload.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  return NextResponse.json({ telegramChatId: user.telegramChatId });
}

// POST: generate a one-time 15-min deep-link the customer opens in Telegram to
// connect their chat. Returns the linkUrl (or 503 if the bot isn't configured).
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  if (!telegramLinkConfigured()) {
    return NextResponse.json(
      { error: "Telegram notifications aren't configured yet. Please try again later." },
      { status: 503 },
    );
  }

  const token = randomUUID();
  await db.user.update({
    where: { id: user.id },
    data: {
      telegramLinkToken: token,
      telegramLinkTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS),
    },
  });

  const linkUrl = telegramLinkUrl(token);
  if (!linkUrl) {
    return NextResponse.json(
      { error: "Telegram notifications aren't configured yet. Please try again later." },
      { status: 503 },
    );
  }
  return NextResponse.json({ linkUrl });
}

// DELETE: disconnect this account's Telegram chat. Kept idempotent — clearing a
// chat that was never linked is a no-op success.
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!user.emailVerified)
    return NextResponse.json({ error: "Email not verified." }, { status: 403 });

  await db.user.update({
    where: { id: user.id },
    data: {
      telegramChatId: null,
      telegramLinkToken: null,
      telegramLinkTokenExpiresAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}