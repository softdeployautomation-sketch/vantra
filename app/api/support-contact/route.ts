import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { allowAndRecord, getClientIp } from "@/lib/rate-limit";
import { notifyAdmin } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Task 69, scope 5 — POST /api/support-contact — body: { email, message }.
//
// The locked-out support surface: deliberately UNAUTHENTICATED (the caller
// may have no working login, license, or device). Writes a SupportContact
// row — never a Ticket (Ticket/TicketMessage keep their real-user FK, this
// route must not weaken that). Rate-limited per-IP like the other public
// routes, and fires the same Telegram admin ping other admin-relevant events
// use so this inbox is never silent.
const bodySchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(5000),
});

export async function POST(request: Request) {
  if (!(await allowAndRecord(await getClientIp(), "support-contact"))) {
    return NextResponse.json(
      { error: "Too many requests, try again later." },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const email = parsed.email.trim().toLowerCase();
  const row = await db.supportContact.create({
    data: { email, message: parsed.message.trim() },
  });

  void notifyAdmin(`🆘 Vantra locked-out contact from ${email}: ${parsed.message.trim().slice(0, 200)}`);

  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}
