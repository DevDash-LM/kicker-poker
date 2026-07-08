// Framework-agnostic Kicker email renderer. Pure JS (no Deno/Node APIs) so it
// can be imported by the Supabase edge function AND unit-tested with vitest.
//
// Brand: dark, minimal, poker-clean. No gambling / money wording anywhere.

const BRAND = {
  bg: "#12151B",
  surface: "#1C2129",
  line: "#2A303B",
  ink: "#ECEEF2",
  muted: "#9AA2AD",
  faint: "#586070",
  accent: "#5B7FFF",
};

// Escape a value going into HTML.
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function subjectLine() {
  return "Your Kicker confirmation code";
}

// opts: { code, logoUrl }
export function renderCodeEmailText({ code }) {
  return [
    "Kicker",
    "",
    "Use this code to sign in to Kicker:",
    "",
    `    ${code}`,
    "",
    "The code signs you in and expires shortly.",
    "If you did not request this, you can ignore this email — no action is needed.",
    "",
    "— Kicker",
  ].join("\n");
}

export function renderCodeEmailHtml({ code, logoUrl }) {
  const safeCode = esc(code);
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Kicker" height="34" style="height:34px;display:block;border:0;outline:none;" />`
    : `<div style="font:800 26px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.03em;color:${BRAND.ink};">Kicker</div>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${BRAND.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:20px;overflow:hidden;">
          <tr><td style="padding:28px 28px 8px 28px;">${logo}</td></tr>
          <tr><td style="padding:8px 28px 0 28px;">
            <div style="font:700 19px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};letter-spacing:-0.02em;">
              Use this code to sign in to Kicker.
            </div>
            <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};margin-top:8px;">
              Enter the code below in the app to finish signing in.
            </div>
          </td></tr>
          <tr><td style="padding:22px 28px;">
            <div style="background:${BRAND.bg};border:1px solid ${BRAND.line};border-radius:14px;padding:20px;text-align:center;">
              <div style="font:800 34px/1 'SFMono-Regular',ui-monospace,Menlo,Consolas,monospace;letter-spacing:.34em;color:${BRAND.ink};padding-left:.34em;">
                ${safeCode}
              </div>
            </div>
          </td></tr>
          <tr><td style="padding:0 28px 26px 28px;">
            <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.muted};">
              The code expires shortly and can only be used once.
            </div>
            <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.faint};margin-top:10px;">
              If you did not request this, you can safely ignore this email — no action is needed.
            </div>
          </td></tr>
        </table>
        <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.faint};margin-top:18px;">
          Kicker — clean Texas Hold'em with friends.
        </div>
      </td></tr>
    </table>
  </body>
</html>`;
}
