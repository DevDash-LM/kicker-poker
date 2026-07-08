import { describe, it, expect } from "vitest";
import {
  renderCodeEmailHtml, renderCodeEmailText, subjectLine, esc,
} from "../supabase/functions/send-email/email-template.js";
import {
  normalizeFriendCode, isValidFriendCode, prettyFriendCode,
  authErrorMessage, addFriendMessage, looksLikeEmail, FRIEND_CODE_RE,
} from "../src/account-util.js";

describe("branded confirmation email", () => {
  const code = "482913";

  it("subject is on-brand", () => {
    expect(subjectLine()).toBe("Your Kicker confirmation code");
  });

  it("html + text both show the code and sign-in intent", () => {
    const html = renderCodeEmailHtml({ code, logoUrl: "https://x/logo-lockup.png" });
    const text = renderCodeEmailText({ code });
    expect(html).toContain(code);
    expect(text).toContain(code);
    expect(html.toLowerCase()).toContain("sign in to kicker");
    expect(text.toLowerCase()).toContain("sign in to kicker");
  });

  it("includes safety copy in both formats", () => {
    const html = renderCodeEmailHtml({ code }).toLowerCase();
    const text = renderCodeEmailText({ code }).toLowerCase();
    expect(html).toContain("did not request");
    expect(text).toContain("did not request");
  });

  it("uses the logo when a url is given, wordmark otherwise", () => {
    expect(renderCodeEmailHtml({ code, logoUrl: "https://x/logo-lockup.png" })).toContain("logo-lockup.png");
    const noLogo = renderCodeEmailHtml({ code, logoUrl: "" });
    expect(noLogo).not.toContain("<img");
    expect(noLogo).toContain("Kicker");
  });

  it("contains no gambling / real-money wording", () => {
    const blob = (renderCodeEmailHtml({ code }) + " " + renderCodeEmailText({ code })).toLowerCase();
    for (const word of ["gambl", "bet ", "wager", "deposit", "payout", "cash", "casino", "buy ", "purchase", "$"]) {
      expect(blob.includes(word)).toBe(false);
    }
  });

  it("escapes HTML in interpolated values", () => {
    expect(esc('<b>&"\'')).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("friend codes", () => {
  it("normalizes to the safe alphabet and length", () => {
    expect(normalizeFriendCode("abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeFriendCode("io01AB23")).toBe("AB23"); // I,O,0,1 stripped
    expect(normalizeFriendCode("ABCDEFGHIJ").length).toBe(8);
  });

  it("validates full 8-char codes only", () => {
    expect(isValidFriendCode("ABCD2345")).toBe(true);
    expect(isValidFriendCode("ABCD234")).toBe(false);
    expect(isValidFriendCode("ABCDO345")).toBe(false); // O not allowed
    expect(FRIEND_CODE_RE.test("HJKMNPQR")).toBe(true);
  });

  it("pretty-prints as 4-4", () => {
    expect(prettyFriendCode("ABCD2345")).toBe("ABCD-2345");
    expect(prettyFriendCode("ABC")).toBe("ABC");
  });
});

describe("friendly messaging", () => {
  it("maps add-friend statuses", () => {
    expect(addFriendMessage("sent").ok).toBe(true);
    expect(addFriendMessage("accepted").ok).toBe(true);
    expect(addFriendMessage("self").ok).toBe(false);
    expect(addFriendMessage("not_found").ok).toBe(false);
    expect(addFriendMessage("already_friends").ok).toBe(false);
    expect(addFriendMessage("weird").message).toMatch(/try again/i);
  });

  it("never leaks raw auth errors", () => {
    expect(authErrorMessage({ status: 429 })).toMatch(/too many/i);
    expect(authErrorMessage({ message: "Token has expired" })).toMatch(/expired/i);
    expect(authErrorMessage({ message: "Invalid OTP" })).toMatch(/didn.t work/i);
    expect(authErrorMessage(null)).toMatch(/something went wrong/i);
    // Should not echo the raw provider text.
    expect(authErrorMessage({ message: "PGRST500 internal" })).not.toMatch(/PGRST/);
  });

  it("sanity-checks email shape", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("nope")).toBe(false);
    expect(looksLikeEmail("a@b")).toBe(false);
  });
});
