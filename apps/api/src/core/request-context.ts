// Author: Brijesh Dave <https://github.com/brijeshdave>
// Per-request context carried through async calls via AsyncLocalStorage. This is
// how the request id reaches code that never sees the Fastify request — notably
// better-auth callbacks and BullMQ producers — so one id traces a user action
// end-to-end (api log -> job log -> client log).
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  userId?: string;
  companyId?: string | null;
  /** Database queries issued while handling this request (debug mode reports it). */
  queryCount: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The current request id, if any (background work outside a request has none). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function incrementQueryCount(): void {
  const store = storage.getStore();
  if (store) store.queryCount += 1;
}

export function currentQueryCount(): number {
  return storage.getStore()?.queryCount ?? 0;
}

/** Enrich the active context once the caller is known. */
export function setRequestActor(userId: string, companyId?: string | null): void {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
    store.companyId = companyId ?? null;
  }
}
