// Author: Brijesh Dave <https://github.com/brijeshdave>
// The queue-management calls. Every one of these 404s unless the server runs with
// QUEUE_ADMIN set — read `session.queueAdmin` before offering them.
import type {
  QueueClean,
  QueueCleanResult,
  QueueDetail,
  QueueJobDetail,
  QueueJobState,
  QueueJobsPage,
  QueueSummary,
} from "@reportly/shared";

import { http } from "@/services/http.js";

export function fetchQueues(): Promise<QueueSummary[]> {
  return http.get<QueueSummary[]>("/queues");
}

export function fetchQueue(id: string): Promise<QueueDetail> {
  return http.get<QueueDetail>(`/queues/${id}`);
}

export function fetchQueueJobs(
  id: string,
  options: { state: QueueJobState; limit?: number; offset?: number },
): Promise<QueueJobsPage> {
  const params = new URLSearchParams({ state: options.state });
  params.set("limit", String(options.limit ?? 20));
  params.set("offset", String(options.offset ?? 0));
  return http.get<QueueJobsPage>(`/queues/${id}/jobs?${params.toString()}`);
}

export function fetchQueueJob(id: string, jobId: string): Promise<QueueJobDetail> {
  return http.get<QueueJobDetail>(`/queues/${id}/jobs/${jobId}`);
}

export function retryQueueJob(id: string, jobId: string): Promise<void> {
  return http.post<void>(`/queues/${id}/jobs/${jobId}/retry`);
}

export function promoteQueueJob(id: string, jobId: string): Promise<void> {
  return http.post<void>(`/queues/${id}/jobs/${jobId}/promote`);
}

export function removeQueueJob(id: string, jobId: string): Promise<void> {
  return http.delete<void>(`/queues/${id}/jobs/${jobId}`);
}

export function setQueuePaused(id: string, paused: boolean): Promise<void> {
  return http.post<void>(`/queues/${id}/${paused ? "pause" : "resume"}`);
}

export function cleanQueue(id: string, input: QueueClean): Promise<QueueCleanResult> {
  return http.post<QueueCleanResult>(`/queues/${id}/clean`, input);
}
