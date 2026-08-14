// Author: Brijesh Dave <https://github.com/brijeshdave>
// The rule worth pinning: the panel offers Edit and Delete strictly on the
// server's `canEdit` / `canDelete`, never on its own comparison of author ids.
// If it ever computed them locally, the screen and the API could disagree — and
// the one people would believe is whichever they hit first.
import type { Comment } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommentsPanel } from "@/components/comments-panel.js";
import * as comments from "@/services/comments.js";

vi.mock("@/services/comments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof comments>()),
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
}));

const fetchComments = vi.mocked(comments.fetchComments);
const deleteComment = vi.mocked(comments.deleteComment);

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    ownerType: "report",
    ownerId: "r1",
    authorId: "u1",
    authorName: "Sam Operator",
    body: "Replaced the belt.",
    parentId: null,
    editedAt: null,
    canEdit: false,
    canDelete: false,
    createdAt: "2026-07-18T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
    ...over,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommentsPanel ownerType="report" ownerId="r1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("CommentsPanel", () => {
  it("says the conversation is open to anyone who can see the record", async () => {
    fetchComments.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/Anyone who can see this can join in/)).toBeInTheDocument();
  });

  it("hides Edit and Delete when the server says the caller may not", async () => {
    fetchComments.mockResolvedValue([comment()]);
    renderPanel();

    await screen.findByText("Replaced the belt.");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offers Edit and Delete when the server says the caller may", async () => {
    fetchComments.mockResolvedValue([comment({ canEdit: true, canDelete: true })]);
    renderPanel();

    await screen.findByText("Replaced the belt.");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers Delete without Edit for a moderator", async () => {
    // Someone holding comments:moderate may remove another person's remark but
    // never rewrite it — putting words in somebody's mouth is not a moderator's
    // job, and the permissions are separate for exactly that reason.
    fetchComments.mockResolvedValue([comment({ canEdit: false, canDelete: true })]);
    renderPanel();

    await screen.findByText("Replaced the belt.");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers neither to somebody without the permissions, even on their own comment", async () => {
    // The server decides; the panel only reflects it. A Member holds neither
    // comments:update nor comments:delete by default, so their own remark carries
    // no controls — and the panel must not invent them from a matching author id.
    fetchComments.mockResolvedValue([comment({ canEdit: false, canDelete: false })]);
    renderPanel();

    await screen.findByText("Replaced the belt.");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    // Posting is still open to anyone who can see the record.
    expect(screen.getByPlaceholderText(/Add to the conversation/)).toBeInTheDocument();
  });

  it("asks before deleting, and does not delete until confirmed", async () => {
    // A deleted comment leaves no trace — unlike an edit, which at least leaves an
    // "edited" mark — and its replies go with it. Worth a question first.
    const user = userEvent.setup({ delay: null });
    fetchComments.mockResolvedValue([comment({ canDelete: true })]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    // The dialog quotes the comment, so nobody deletes the wrong one from a list
    // of similar-looking remarks.
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(deleteComment).not.toHaveBeenCalled();

    // Confirming is what actually calls the API.
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteComment).toHaveBeenCalledWith("c1");
  });

  it("marks an edited comment as edited", async () => {
    // So a revised remark is not mistaken for the one people replied to.
    fetchComments.mockResolvedValue([comment({ editedAt: "2026-07-18T10:00:00.000Z" })]);
    renderPanel();
    expect(await screen.findByText("edited")).toBeInTheDocument();
  });

  it("nests a reply under its parent and offers no further reply on it", async () => {
    // One level only — the API flattens a reply-to-a-reply onto its parent, so the
    // UI must not invite a depth it cannot render.
    fetchComments.mockResolvedValue([
      comment({ id: "root", body: "The tensioner looks worn." }),
      comment({ id: "child", parentId: "root", authorName: "Ravi Lead", body: "Order one." }),
    ]);
    renderPanel();

    await screen.findByText("The tensioner looks worn.");
    expect(screen.getByText("Order one.")).toBeInTheDocument();
    // Only the root comment carries a Reply control.
    expect(screen.getAllByRole("button", { name: "Reply" })).toHaveLength(1);
  });
});
