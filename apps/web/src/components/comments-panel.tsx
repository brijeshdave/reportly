// Author: Brijesh Dave <https://github.com/brijeshdave>
// The conversation on a report or a task. One component for both, because the API
// is one feature for both.
//
// Every comment arrives carrying `canEdit` / `canDelete` computed by the server
// for this caller. The UI never works those out from ids: if it did, what the
// screen offers and what the API allows could disagree, and the version people
// believe is whichever one they hit first.
import { formatDateTime } from "@reportly/shared";
import type { Comment, CommentOwnerType } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner, Textarea } from "@/components/ui/form.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { addComment, deleteComment, editComment, fetchComments } from "@/services/comments.js";

export function CommentsPanel({
  ownerType,
  ownerId,
}: {
  ownerType: CommentOwnerType;
  ownerId: string;
}) {
  const queryClient = useQueryClient();
  const key = ["comments", ownerType, ownerId];

  const comments = useQuery({ queryKey: key, queryFn: () => fetchComments(ownerType, ownerId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: () =>
      addComment(ownerType, ownerId, {
        body: body.trim(),
        ...(replyTo ? { parentId: replyTo } : {}),
      }),
    onSuccess: async () => {
      setBody("");
      setReplyTo(null);
      await refresh();
    },
  });

  const all = comments.data ?? [];
  // Threading is assembled here from parentId, the same way the asset and
  // department trees are built from theirs. One level only — the API flattens a
  // reply-to-a-reply onto its parent, so there is never a deeper tree to render.
  const roots = all.filter((c) => !c.parentId);
  const repliesOf = (id: string) => all.filter((c) => c.parentId === id);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4" />
        Conversation
        {all.length > 0 ? (
          <span className="text-xs font-normal text-muted-foreground">({all.length})</span>
        ) : null}
      </h2>

      {comments.isLoading ? <Spinner /> : null}
      {comments.error ? <ErrorAlert error={comments.error} /> : null}

      {all.length === 0 && !comments.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Anyone who can see this can join in.
        </p>
      ) : null}

      {/* `min-w-0` at every level: without it a long word or URL in a comment
          forces the whole column wider than its grid track, which reads as panels
          overlapping rather than as text overflowing. */}
      {/* The thread scrolls inside the card rather than growing the page. A busy
          report can carry dozens of remarks, and without this the panels beneath
          it end up a screen and a half down. Capped against the viewport so it
          adapts to the window rather than assuming one. */}
      <ol className="flex max-h-[55vh] min-w-0 flex-col gap-4 overflow-y-auto pr-1">
        {roots.map((comment) => (
          <li key={comment.id} className="flex min-w-0 flex-col gap-2">
            <CommentItem
              comment={comment}
              onChanged={refresh}
              onReply={() => setReplyTo(comment.id)}
            />
            {repliesOf(comment.id).length > 0 ? (
              // A modest indent with a rule down the side. Deeper padding looks
              // fine in a wide column and squeezes a narrow one to nothing.
              <ol className="flex min-w-0 flex-col gap-3 border-l-2 border-border pl-3">
                {repliesOf(comment.id).map((reply) => (
                  <li key={reply.id} className="min-w-0">
                    <CommentItem comment={reply} onChanged={refresh} />
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        {replyTo ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Replying to a comment
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="underline underline-offset-2"
            >
              cancel
            </button>
          </p>
        ) : null}
        {post.error ? <ErrorAlert error={post.error} /> : null}
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Add to the conversation…"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => post.mutate()}
            disabled={post.isPending || body.trim() === ""}
          >
            {post.isPending ? <Spinner /> : null}
            {replyTo ? "Reply" : "Comment"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CommentItem({
  comment,
  onChanged,
  onReply,
}: {
  comment: Comment;
  onChanged: () => void;
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const save = useMutation({
    mutationFn: () => editComment(comment.id, draft.trim()),
    onSuccess: async () => {
      setEditing(false);
      onChanged();
    },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({ mutationFn: () => deleteComment(comment.id), onSuccess: onChanged });

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{comment.authorName}</span>
        <span>{formatDateTime(comment.createdAt)}</span>
        {/* An edited remark says so, so it is not mistaken for the one people
            replied to. */}
        {comment.editedAt ? <span className="italic">edited</span> : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
          {save.error ? <ErrorAlert error={save.error} /> : null}
        </div>
      ) : (
        // `whitespace-pre-wrap` keeps the author's own line breaks;
        // `break-words` stops an unbroken URL from widening the column past its
        // grid track. Both are needed — either alone gets one case wrong.
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
      )}

      <div className="flex gap-3 text-xs text-muted-foreground">
        {onReply ? (
          <button type="button" onClick={onReply} className="underline-offset-2 hover:underline">
            Reply
          </button>
        ) : null}
        {/* Offered strictly on the server's verdict, never inferred from ids. */}
        {comment.canEdit && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="underline-offset-2 hover:underline"
          >
            Edit
          </button>
        ) : null}
        {comment.canDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={remove.isPending}
            className="underline-offset-2 hover:underline"
          >
            Delete
          </button>
        ) : null}
      </div>
      {remove.error ? <ErrorAlert error={remove.error} /> : null}

      {/* Asked before, not undone after: a comment leaves no trace when it goes —
          unlike an edit, which at least leaves an "edited" mark — and replies to it
          go with it. */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this comment?"
        description={
          <>
            <p>This cannot be undone, and any replies to it go too.</p>
            <p className="mt-2 rounded-lg bg-muted p-2 text-sm italic">“{comment.body}”</p>
          </>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </div>
  );
}
