// Author: Brijesh Dave <https://github.com/brijeshdave>
// Conversations on reports and tasks, and the collaboration reads that go with a
// report — who holds it, who worked it, how it changed hands.
import type {
  AssignJournalEntry,
  Comment,
  CommentOwnerType,
  CreateComment,
  JournalEntry,
  JournalHandover,
  JournalParticipant,
} from "@reportly/shared";

import { http } from "@/services/http.js";

/**
 * Reports and tasks each own their comments, so the path names the record.
 *
 * A journal entry's path is `journal`, not `reports`: the domain was renamed and
 * the old route no longer exists, so this returning "reports" made every
 * conversation on an entry 404 while looking like an empty thread.
 */
const ownerPath = (ownerType: CommentOwnerType): string =>
  ownerType === "task" ? "tasks" : "journal";

export const fetchComments = (ownerType: CommentOwnerType, ownerId: string) =>
  http.get<Comment[]>(`/${ownerPath(ownerType)}/${ownerId}/comments`);

export const addComment = (ownerType: CommentOwnerType, ownerId: string, input: CreateComment) =>
  http.post<Comment>(`/${ownerPath(ownerType)}/${ownerId}/comments`, input);

// Editing and deleting key off the comment itself — the server re-checks that the
// caller can still see the record it is on.
export const editComment = (id: string, body: string) =>
  http.patch<Comment>(`/comments/${id}`, { body });

export const deleteComment = (id: string) => http.delete<void>(`/comments/${id}`);

/* ----------------------- report collaboration ------------------------------ */

export const assignReport = (reportId: string, input: AssignJournalEntry) =>
  http.post<JournalEntry>(`/journal/${reportId}/assign`, input);

export const fetchHandovers = (reportId: string) =>
  http.get<JournalHandover[]>(`/journal/${reportId}/handovers`);

export const fetchParticipants = (reportId: string) =>
  http.get<JournalParticipant[]>(`/journal/${reportId}/participants`);

export const setParticipants = (reportId: string, participants: { userId: string }[]) =>
  http.put<JournalParticipant[]>(`/journal/${reportId}/participants`, { participants });
