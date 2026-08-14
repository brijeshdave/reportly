// Author: Brijesh Dave <https://github.com/brijeshdave>
// The 2FA step machine drives real UI here: the password step must hand off to the
// challenge, the challenge must call the right verifier, and a wrong code must not
// advance the flow.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { LoginPage } from "@/routes/auth/login.js";
import * as auth from "@/services/auth.js";

vi.mock("@/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  signInWithPassword: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
}));

const signInWithPassword = vi.mocked(auth.signInWithPassword);
const verifyTotp = vi.mocked(auth.verifyTotp);
const verifyBackupCode = vi.mocked(auth.verifyBackupCode);

/** Mount LoginPage at /login so its `useSearch({ from: "/login" })` resolves. */
function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // No SSO providers configured: the buttons render nothing.
  queryClient.setQueryData(queryKeys.ssoProviders, []);

  const rootRoute = createRootRoute();
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
      redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    }),
    component: LoginPage,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Dashboard</h1>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute, indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/login"] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
  return router;
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Email or username"), "user@acme.test");
  await user.type(screen.getByLabelText("Password"), "Sup3rSecretPass");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("sign-in", () => {
  it("goes straight to the app when the account has no 2FA", async () => {
    signInWithPassword.mockResolvedValue({ twoFactorRequired: false });
    const user = userEvent.setup({ delay: null });
    renderLogin();

    await signIn(user);

    expect(signInWithPassword).toHaveBeenCalledWith("user@acme.test", "Sup3rSecretPass");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("shows the error and stays put when the password is wrong", async () => {
    signInWithPassword.mockRejectedValue(new Error("Invalid email or password"));
    const user = userEvent.setup({ delay: null });
    renderLogin();

    await signIn(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("challenges for a TOTP code, then signs in", async () => {
    signInWithPassword.mockResolvedValue({ twoFactorRequired: true });
    verifyTotp.mockResolvedValue(undefined);
    const user = userEvent.setup({ delay: null });
    renderLogin();

    await signIn(user);
    await screen.findByRole("heading", { name: "Two-factor authentication" });

    await user.type(screen.getByLabelText("Authentication code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(verifyTotp).toHaveBeenCalledWith("123456");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("falls back to a recovery code and clears the previous entry", async () => {
    signInWithPassword.mockResolvedValue({ twoFactorRequired: true });
    verifyBackupCode.mockResolvedValue(undefined);
    const user = userEvent.setup({ delay: null });
    renderLogin();

    await signIn(user);
    await user.type(await screen.findByLabelText("Authentication code"), "000000");
    await user.click(screen.getByRole("button", { name: "Use a recovery code" }));

    const recoveryInput = await screen.findByLabelText("Recovery code");
    expect(recoveryInput).toHaveValue("");

    await user.type(recoveryInput, "ABCDE-FGHIJ");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(verifyBackupCode).toHaveBeenCalledWith("ABCDE-FGHIJ");
    expect(verifyTotp).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("keeps the challenge open when the code is rejected", async () => {
    signInWithPassword.mockResolvedValue({ twoFactorRequired: true });
    verifyTotp.mockRejectedValue(new Error("Invalid code"));
    const user = userEvent.setup({ delay: null });
    renderLogin();

    await signIn(user);
    await user.type(await screen.findByLabelText("Authentication code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
    expect(screen.getByRole("heading", { name: "Two-factor authentication" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("returns to the password step from the challenge", async () => {
    signInWithPassword.mockResolvedValue({ twoFactorRequired: true });
    const user = userEvent.setup({ delay: null });
    renderLogin();

    await signIn(user);
    await user.click(await screen.findByRole("button", { name: "Back to sign in" }));

    expect(await screen.findByRole("heading", { name: "Sign in to Reportly" })).toBeInTheDocument();
  });

  it("honours the redirect the guard asked for", async () => {
    signInWithPassword.mockResolvedValue({ twoFactorRequired: false });
    const user = userEvent.setup({ delay: null });
    const router = renderLogin();
    await router.navigate({ to: "/login", search: { redirect: "/" } });

    await signIn(user);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});
