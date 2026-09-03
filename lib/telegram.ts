import "server-only";

import { env } from "./env";

/** Fire-and-forget by design — a Telegram outage must never break the request
 *  that triggered the notification (signup, payment submit, etc). Logs and
 *  swallows any failure. No-ops entirely if the bot isn't configured. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!env.telegramBotToken) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("Telegram sendMessage failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Telegram sendMessage threw:", err);
  }
}

/** Ops alerts — always goes to the one fixed admin chat, never a customer's. */
export function notifyAdmin(text: string): Promise<void> {
  if (!env.adminTelegramChatId) return Promise.resolve();
  return sendTelegramMessage(env.adminTelegramChatId, text);
}

export function telegramLinkUrl(token: string): string | null {
  if (!env.telegramBotUsername) return null;
  return `https://t.me/${env.telegramBotUsername}?start=${token}`;
}

/** True when a customer's own Telegram channel is configured well enough to
 *  link chats (bot username present). Used to return a clean 503 a client can
 *  surface instead of silently generating a broken link. */
export function telegramLinkConfigured(): boolean {
  return !!env.telegramBotUsername;
}