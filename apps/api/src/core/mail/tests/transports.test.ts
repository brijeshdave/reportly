// Author: Brijesh Dave <https://github.com/brijeshdave>
// Sending through a provider's API instead of SMTP.
//
// Built because SMTP cannot say why it refused you until far too late: this
// installation had a relay that accepted the connection and then refused every
// message for an unauthorised sending domain, and the refusal never reached the
// app at all.
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_TRANSPORTS } from "@/core/mail/transports/index.js";

const message = {
  to: "banti@rayzon.example",
  subject: "Reportly test message",
  html: "<p>hello</p>",
  text: "hello",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stand in for the provider, and keep what the caller sent. */
function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("the provider transports", () => {
  it("posts one authenticated request, with no vendor SDK involved", async () => {
    const fetchMock = stubFetch(new Response("{}", { status: 200 }));
    await API_TRANSPORTS.resend!(message);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
    expect(bodyOf(fetchMock)).toMatchObject({ to: [message.to], subject: message.subject });
  });

  it("keeps the provider's refusal word for word", async () => {
    // The entire reason for preferring an API: this sentence is the diagnosis.
    const refusal =
      '{"message":"API key not authorized for this domain: rayzon.example","name":"validation_error"}';
    stubFetch(new Response(refusal, { status: 403 }));

    await expect(API_TRANSPORTS.resend!(message)).rejects.toThrow(
      /API key not authorized for this domain: rayzon\.example/,
    );
  });

  it("treats a silent non-2xx as a failure, not as consent", async () => {
    stubFetch(new Response("", { status: 500 }));
    await expect(API_TRANSPORTS.postmark!(message)).rejects.toThrow(/Postmark refused/);
  });

  it("names the provider when it cannot be reached at all", async () => {
    // Otherwise the message log reads "fetch failed", with no clue which one.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.sendgrid.com")),
    );
    await expect(API_TRANSPORTS.sendgrid!(message)).rejects.toThrow(
      /SendGrid could not be reached: getaddrinfo/,
    );
  });

  it("sends SendGrid its plain text first, as it insists", async () => {
    const fetchMock = stubFetch(new Response("", { status: 202 }));
    await API_TRANSPORTS.sendgrid!(message);

    const content = bodyOf(fetchMock).content as { type: string }[];
    expect(content[0]!.type).toBe("text/plain");
    expect(content[1]!.type).toBe("text/html");
  });

  it("splits a `Name <address>` from-line into the parts providers want", async () => {
    const fetchMock = stubFetch(new Response("", { status: 200 }));
    await API_TRANSPORTS.sendgrid!(message);

    // MAIL_FROM defaults to "Reportly <no-reply@reportly.local>".
    expect(bodyOf(fetchMock).from).toEqual({
      email: "no-reply@reportly.local",
      name: "Reportly",
    });
  });
});
