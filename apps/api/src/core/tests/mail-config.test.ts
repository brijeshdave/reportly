// Author: Brijesh Dave <https://github.com/brijeshdave>
// A mail transport chosen without the credential it needs must fail the boot.
//
// The alternative — falling back to SMTP — is an installation that believes it is
// sending through Resend and is in fact posting to localhost:1025. That is the
// quiet non-delivery this whole area of the app was built to end, and it would be
// a shame to reintroduce it in the fix.
import { describe, expect, it } from "vitest";

import { mailConfigErrors, type Env } from "@/core/env.js";

function withTransport(overrides: Partial<Env>): Env {
  // Development by default: the localhost relay is Mailpit, and is the point.
  return { MAIL_TRANSPORT: "smtp", NODE_ENV: "development", ...overrides } as Env;
}

describe("mail configuration", () => {
  it("is happy with SMTP, which needs no key", () => {
    expect(mailConfigErrors(withTransport({}))).toEqual([]);
  });

  it("refuses a provider with no key, naming the variable to set", () => {
    const errors = mailConfigErrors(withTransport({ MAIL_TRANSPORT: "resend" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("RESEND_API_KEY");
    // And says what it would cost, rather than only what is missing.
    expect(errors[0]).toContain("no email could be sent");
  });

  it("accepts each provider once its own credential is there", () => {
    expect(
      mailConfigErrors(withTransport({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" })),
    ).toEqual([]);
    expect(
      mailConfigErrors(withTransport({ MAIL_TRANSPORT: "sendgrid", SENDGRID_API_KEY: "SG.x" })),
    ).toEqual([]);
    expect(
      mailConfigErrors(withTransport({ MAIL_TRANSPORT: "postmark", POSTMARK_TOKEN: "pm-x" })),
    ).toEqual([]);
  });

  it("does not accept another provider's key in its place", () => {
    // A copy-paste between blocks is exactly how this goes wrong at 2am.
    expect(
      mailConfigErrors(withTransport({ MAIL_TRANSPORT: "resend", SENDGRID_API_KEY: "SG.x" })),
    ).toHaveLength(1);
  });

  it("refuses production SMTP that still points at localhost", () => {
    // compose.prod.yaml used to enforce this with `${SMTP_HOST:?}`. That became a
    // trap when a provider API arrived: an install sending through Resend was held
    // up over a relay it does not use. Compose cannot know the transport; this can.
    const errors = mailConfigErrors(withTransport({ NODE_ENV: "production" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("SMTP_HOST");
    expect(errors[0]).toContain("queue and never arrive");
  });

  it("does not ask a provider install for an SMTP relay it never uses", () => {
    expect(
      mailConfigErrors(
        withTransport({
          NODE_ENV: "production",
          MAIL_TRANSPORT: "resend",
          RESEND_API_KEY: "re_x",
        }),
      ),
    ).toEqual([]);
  });

  it("leaves development pointing at Mailpit", () => {
    expect(mailConfigErrors(withTransport({ SMTP_HOST: "localhost" }))).toEqual([]);
  });
});
