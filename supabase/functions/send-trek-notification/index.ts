import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// AUTH MODEL (post key-migration):
// This function is deployed with verify_jwt = FALSE, because the new
// publishable/secret API keys are not JWTs and cannot pass the platform's
// verify_jwt check. Instead we authorize the caller ourselves with a shared
// WEBHOOK SECRET sent by the DB trigger on the `x-trek-webhook-secret` header.
// The admin Supabase client uses the SECRET key (sb_secret_…), auto-injected as
// SUPABASE_SECRET_KEYS — it never travels over the wire from the database.
// Required function secrets: TrekNotification (Resend), TREK_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------

const RESEND_API_KEY = Deno.env.get("TrekNotification")!;
const WEBHOOK_SECRET = Deno.env.get("TREK_WEBHOOK_SECRET")!;

// Secret key replaces the legacy service_role key. Auto-injected as a JSON
// object keyed by key name; fall back to single-key / legacy env for local dev.
function getServiceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    const obj = JSON.parse(raw);
    return (obj["default"] ?? Object.values(obj)[0]) as string;
  }
  return Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

// trekName/trekLocation/trekPhoto come from trek data set by trek creators and
// are interpolated into the HTML email body below — escape before use.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Constant-time secret check. The `!==` this replaces short-circuits on the
// first differing byte, so how far a guess matched is in principle observable.
// Digesting both sides first makes the comparison run over fixed-length data
// the caller cannot steer — neither the secret's length nor a partial match
// leaks. (Network jitter already swamps the signal; this removes it anyway.)
async function secretMatches(provided: string | null): Promise<boolean> {
  if (provided === null) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(WEBHOOK_SECRET)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

serve(async (req: Request) => {
  // Authorize the DB trigger before doing anything else.
  if (!(await secretMatches(req.headers.get("x-trek-webhook-secret")))) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();

    if (payload.type !== "INSERT") {
      return new Response("OK", { status: 200 });
    }

    const record = payload.record;
    const { user_id, batch_id } = record;

    if (!user_id || !batch_id) {
      return new Response("Missing user_id or batch_id", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, getServiceKey());

    // Fetch user email + trek details in parallel
    const [userResult, batchResult] = await Promise.all([
      supabase.from("profiles").select("email, full_name").eq("id", user_id).single(),
      supabase
        .from("trek_batches")
        .select("batch_date, treks(title, cover_image_url, location)")
        .eq("id", batch_id)
        .single(),
    ]);

    // Get email (fallback to auth.users)
    let userEmail = userResult.data?.email;
    if (!userEmail) {
      const { data: userData } = await supabase.auth.admin.getUserById(user_id);
      userEmail = userData?.user?.email;
    }

    if (!userEmail) {
      console.error("No email found for user:", user_id);
      return new Response("No email", { status: 400 });
    }

    // Rate-limit outbound notification emails per recipient. Past the webhook
    // secret check, user_id is caller-chosen and this URL is reachable directly
    // (skipping join_trek_and_chat()'s own 10/hr join throttle), so without this
    // a leaked secret is unbounded mail-bombing capacity. Shared with
    // send-trek-leave-notification via the same 'trek_email' action so
    // alternating the two endpoints can't double the effective rate.
    const { count: emailCount } = await supabase
      .from("rate_events")
      .select("*", { count: "exact", head: true })
      .eq("actor", user_id)
      .eq("action", "trek_email")
      .gt("at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    if ((emailCount ?? 0) >= 10) {
      console.warn(`Rate limit hit for user ${user_id}, skipping notification email`);
      return new Response("Rate limited", { status: 429 });
    }

    await supabase.from("rate_events").insert({ actor: user_id, action: "trek_email" });

    const trek = batchResult.data?.treks || {};
    const trekName = trek.title || "the trek";
    const trekPhoto = trek.cover_image_url || "";
    const trekLocation = trek.location || "";
    const trekDate = batchResult.data?.batch_date
      ? new Date(batchResult.data.batch_date).toLocaleDateString("en-IN", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "TBD";

    const subject = `You joined ${trekName}! 🏔️`;

    const trekNameSafe = escapeHtml(trekName);
    const trekLocationSafe = escapeHtml(trekLocation);
    const trekPhotoSafe = escapeHtml(trekPhoto);

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="background-color: #1a1a2e;">
          <tr>
            <td style="padding: 40px 20px; text-align: center; color: white;">

              <h1 style="margin: 0 0 10px 0; font-size: 28px;">🎉 Congratulations!</h1>

              <h2 style="margin: 0 0 20px 0; font-size: 24px;">
                You joined <strong>${trekNameSafe}</strong>
              </h2>

              <p style="font-size: 18px; margin: 15px 0;">
                <strong>📅 Date:</strong> ${trekDate}
              </p>

              ${trekLocation ? `
              <p style="font-size: 16px; margin: 10px 0;">
                <strong>📍 Location:</strong> ${trekLocationSafe}
              </p>` : ""}

              ${trekPhoto ? `
              <img src="${trekPhotoSafe}"
                   style="max-width: 100%; height: auto; border-radius: 12px; margin: 20px 0;"
                   alt="${trekNameSafe}">
              ` : ""}

              <p style="font-size: 16px; line-height: 1.6;">
                Get ready for an amazing adventure! Check the app for trek details,
                packing lists, and your fellow trekkers.
              </p>

            </td>
          </tr>
        </table>

        <div style="padding: 20px; text-align: center; color: #666; font-size: 13px;">
          Sent with ❤️ by the Antigravity Team
        </div>
      </div>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Antigravity <onboarding@resend.dev>",
        to: [userEmail],
        subject,
        html: htmlContent,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend API error:", errText);
      return new Response("Failed to send email", { status: 500 });
    }

    console.log(`Welcome email sent to ${userEmail} for trek: ${trekName}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Detail stays in the function logs; the caller gets a generic message.
    console.error("Error in send-trek-notification:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
});