// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one list of background queues.
//
// Each queue module owns its own `Queue` lazily and exports a getter; until now
// nothing enumerated them, so "which queues are there" had no answer in code —
// only in whoever remembered to look in five files.
//
// `core/queue/tests/registry.test.ts` reads every `*_QUEUE` constant exported
// under this directory and fails if one is missing here. A sixth queue added next
// year and forgotten would otherwise be a queue nobody can see, which is the same
// shape as the dead permissions and the uncalled scope helper.
import type { Queue } from "bullmq";

import { getBackupQueue } from "@/core/queue/backup.js";
import { getEmailQueue } from "@/core/queue/email.js";
import { getMaintenanceQueue } from "@/core/queue/maintenance.js";
import { getNotificationQueue } from "@/core/queue/notifications.js";
import { getRoutineAwardQueue } from "@/core/queue/routine-award.js";

export interface QueueEntry {
  id: string;
  label: string;
  /** What work it carries. Read by operators who did not build the app. */
  description: string;
  /**
   * Lazy on purpose. Calling this constructs a BullMQ `Queue`, which opens Redis
   * connections — so merely importing the registry must not, or every test and
   * every CLI command would need infrastructure.
   */
  get: () => Queue;
}

export const QUEUE_REGISTRY: readonly QueueEntry[] = [
  {
    id: "email",
    label: "Email",
    description: "Every outgoing message: invitations, password resets, notification mail.",
    get: getEmailQueue,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "One job per event. The worker resolves who it concerns and writes their inbox.",
    get: getNotificationQueue,
  },
  {
    id: "maintenance",
    label: "Maintenance",
    description: "Daily housekeeping — log retention and the notification prune.",
    get: getMaintenanceQueue,
  },
  {
    id: "backup",
    label: "Backups",
    description: "The daily sweep that takes any due backup and expires old ones.",
    get: getBackupQueue,
  },
  {
    id: "routine-award",
    label: "Routine awards",
    description: "The month-end run that scores completed routines into the points ledger.",
    get: getRoutineAwardQueue,
  },
];

export function findQueue(id: string): QueueEntry | undefined {
  return QUEUE_REGISTRY.find((entry) => entry.id === id);
}
