// Author: Brijesh Dave <https://github.com/brijeshdave>
// Enrolment is where a user can lock themselves out: the recovery codes are shown
// once, and 2FA only becomes active after a code is verified. Both are pinned.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TwoFactorSetup } from "@/routes/profile/two-factor-setup.js";
import * as auth from "@/services/auth.js";

vi.mock("@/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  startTwoFactorEnrolment: vi.fn(),
  verifyTotp: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fake") },
}));

const startTwoFactorEnrolment = vi.mocked(auth.startTwoFactorEnrolment);
const verifyTotp = vi.mocked(auth.verifyTotp);

const onDone = vi.fn();
const onCancel = vi.fn();

const enrolment = {
  totpURI: "otpauth://totp/Reportly:me@acme.test?secret=JBSWY3DPEHPK3PXP&issuer=Reportly",
  backupCodes: ["aaaa-1111", "bbbb-2222"],
};

function renderSetup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TwoFactorSetup onDone={onDone} onCancel={onCancel} />
    </QueryClientProvider>,
  );
}

/** Password step -> QR step. */
async function reachQrStep(user: ReturnType<typeof userEvent.setup>) {
  startTwoFactorEnrolment.mockResolvedValue(enrolment);
  await user.type(screen.getByLabelText("Current password"), "Sup3rSecretPass");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText(/Scan this with your authenticator app/);
}

beforeEach(() => vi.clearAllMocks());

describe("two-factor enrolment", () => {
  it("requires the current password before issuing a factor", async () => {
    const user = userEvent.setup({ delay: null });
    renderSetup();

    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.type(screen.getByLabelText("Current password"), "Sup3rSecretPass");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(startTwoFactorEnrolment).toHaveBeenCalledWith("Sup3rSecretPass");
  });

  it("surfaces a wrong password and stays on the first step", async () => {
    startTwoFactorEnrolment.mockRejectedValue(new Error("Invalid password"));
    const user = userEvent.setup({ delay: null });
    renderSetup();

    await user.type(screen.getByLabelText("Current password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid password");
    expect(screen.queryByText(/Scan this/)).not.toBeInTheDocument();
  });

  it("shows the recovery codes and the manual setup key", async () => {
    const user = userEvent.setup({ delay: null });
    renderSetup();
    await reachQrStep(user);

    expect(screen.getByText("aaaa-1111")).toBeInTheDocument();
    expect(screen.getByText("bbbb-2222")).toBeInTheDocument();
    // The secret, for someone typing it in by hand.
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("refuses to finish until the recovery codes are acknowledged", async () => {
    const user = userEvent.setup({ delay: null });
    renderSetup();
    await reachQrStep(user);

    await user.type(screen.getByLabelText("Authentication code"), "123456");
    const finish = screen.getByRole("button", { name: "Turn on two-factor" });
    expect(finish).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /saved these codes/ }));
    expect(finish).toBeEnabled();
  });

  it("activates only after a code is verified", async () => {
    verifyTotp.mockResolvedValue(undefined);
    const user = userEvent.setup({ delay: null });
    renderSetup();
    await reachQrStep(user);

    // Nothing is active yet at the QR step.
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: /saved these codes/ }));
    await user.type(screen.getByLabelText("Authentication code"), "123456");
    await user.click(screen.getByRole("button", { name: "Turn on two-factor" }));

    expect(verifyTotp).toHaveBeenCalledWith("123456");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("does not complete when the code is rejected", async () => {
    verifyTotp.mockRejectedValue(new Error("Invalid code"));
    const user = userEvent.setup({ delay: null });
    renderSetup();
    await reachQrStep(user);

    await user.click(screen.getByRole("checkbox", { name: /saved these codes/ }));
    await user.type(screen.getByLabelText("Authentication code"), "000000");
    await user.click(screen.getByRole("button", { name: "Turn on two-factor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
    expect(onDone).not.toHaveBeenCalled();
  });
});
