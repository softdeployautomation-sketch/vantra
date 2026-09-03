import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendTelegramMessage } from "@/lib/telegram";

// Telegram delivery point for the customer self-serve linking flow. Telegram
// registers the bot webhook with a secret string, delivered back on EVERY
// request as X-Telegram-Bot-Api-Secret-Token. We compare it exactly, and fail
// CLOSED (401) when the secret isn't configured or doesn't match — same posture
// as the admin passcode. No customer session cookie here by design.
export async function POST(request: Request) {
  if (
    !env.telegramWebhookSecret ||
    request.headers.get("x-telegram-bot-api-secret-token") !== env.telegramWebhookSecret
  ) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  const text: string | undefined = update?.message?.text;
  const chatId: string | undefined = update?.message?.chat?.id?.toString();
  // Ignore anything that isn't a /start message (polling answers, edited msgs, etc).
  if (!text || !chatId) return NextResponse.json({ ok: true });

  const match = text.match(/^\/start\s+(\S+)$/);
  if (!match) {
    await sendTelegramMessage(
      chatId,
      "This bot is used to link your Vantra account. Get your link from Settings in the Vantra dashboard.",
    );
    return NextResponse.json({ ok: true });
  }

  const token = match[1];
  const user = await db.user.findFirst({
    where: { telegramLinkToken: token, telegramLinkTokenExpiresAt: { gt: new Date() } },
  });
  if (!user) {
    await sendTelegramMessage(chatId, "That link has expired. Generate a new one from Settings.");
    return NextResponse.json({ ok: true });
  }

  await db.user.update({
    where: { id: user.id },
    data: { telegramChatId: chatId, telegramLinkToken: null, telegramLinkTokenExpiresAt: null },
  });
  await sendTelegramMessage(
    chatId,
    "✅ Your Vantra account is now linked. You'll get alerts here based on your notification settings.",
  );
  return NextResponse.json({ ok: true });
}