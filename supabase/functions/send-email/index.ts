// Supabase "Send Email" Auth Hook.
// Renders Kicker's branded confirmation-code email and delivers it via Resend.
//
// Configure (Dashboard → Auth → Hooks → "Send Email"):
//   - point the hook at this function's URL
//   - set the hook secret; store it here as SEND_EMAIL_HOOK_SECRET
//
// Function secrets (supabase secrets set ...):
//   RESEND_API_KEY          required to actually send (else the code is logged)
//   KICKER_EMAIL_FROM       e.g. "Kicker <login@yourdomain.com>"
//   KICKER_PUBLIC_URL       e.g. "https://kicker.example.com" (for the logo)
//   SEND_EMAIL_HOOK_SECRET  the hook's signing secret ("v1,whsec_...")
//
// Deploy: supabase functions deploy send-email --no-verify-jwt
//
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { renderCodeEmailHtml, renderCodeEmailText, subjectLine } from "./email-template.js";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM = Deno.env.get("KICKER_EMAIL_FROM") || "Kicker <onboarding@resend.dev>";
const PUBLIC_URL = (Deno.env.get("KICKER_PUBLIC_URL") || "").replace(/\/$/, "");
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";

const CODE_ACTIONS = new Set(["magiclink", "signup", "email", "otp", "login", "recovery"]);

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) {
    // Dev fallback: no provider configured — log so the flow is still testable.
    console.log(`[send-email] (no RESEND_API_KEY) code email for ${to}:\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
}

Deno.serve(async (req) => {
  try {
    const payload = await req.text();

    let data: any;
    if (HOOK_SECRET) {
      // Verify the Standard Webhooks signature so only Supabase can trigger sends.
      const headers = Object.fromEntries(req.headers);
      // Supabase stores the secret as "v1,whsec_<base64>"; the library wants the base64.
      const wh = new Webhook(HOOK_SECRET.replace(/^v1,whsec_/, ""));
      data = wh.verify(payload, headers);
    } else {
      console.warn("[send-email] SEND_EMAIL_HOOK_SECRET not set — skipping signature check (dev only)");
      data = JSON.parse(payload);
    }

    const email = data?.user?.email;
    const action = data?.email_data?.email_action_type;
    const code = data?.email_data?.token;

    if (!email || !code) {
      return new Response(JSON.stringify({ error: "missing email or code" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (action && !CODE_ACTIONS.has(action)) {
      // Not a sign-in code email we brand; let Supabase's default handle nothing.
      // Returning 200 with no send avoids blocking non-login auth flows.
      console.log(`[send-email] ignoring action "${action}"`);
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const logoUrl = PUBLIC_URL ? `${PUBLIC_URL}/logo-lockup-white.png` : "";
    await sendViaResend(
      email,
      subjectLine(),
      renderCodeEmailHtml({ code, logoUrl }),
      renderCodeEmailText({ code }),
    );

    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[send-email] failed:", err);
    // 500 tells Supabase the email wasn't sent (it will surface an auth error).
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
