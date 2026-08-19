// Author: Brijesh Dave <https://github.com/brijeshdave>
// Database and file backups: take one now, download it, delete it. The automatic schedule
// and how long each kind is kept are set in Settings → Backups. Restore lives on each row
// (superadmin only) and behind a typed confirmation.
import { BACKUP_KIND_LABELS, type Backup, type BackupKind, formatDateTime } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Archive,
  Database,
  Download,
  FileText,
  HardDrive,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { useState } from "react";

import { sessionQuery } from "@/lib/queries.js";
import { RestoreDialog } from "@/routes/backups/restore-dialog.js";
import {
  deleteBackup,
  downloadBackup,
  downloadBackupLog,
  fetchBackups,
  runBackup,
} from "@/services/backups.js";

function humanSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(n >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}

export function BackupsPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const backups = useQuery({ queryKey: ["backups"], queryFn: fetchBackups });
  const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null);
  // Restore is superadmin-only and destructive; the server enforces it too.
  const canRestore = session.isSuperadmin;
  const [restoreTarget, setRestoreTarget] = useState<Backup | "upload" | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backups"] });

  const take = useMutation({
    mutationFn: (kind: BackupKind) => runBackup(kind),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteBackup(id),
    onSuccess: invalidate,
  });

  const rows = backups.data ?? [];

  return (
    <>
      <PageHeader
        title="Backups"
        description="Take a database or files backup now, or set an automatic schedule and retention in Settings → Backups."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={take.isPending}
              onClick={() => take.mutate("database")}
            >
              <Database className="h-4 w-4" /> Back up database
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={take.isPending}
              onClick={() => take.mutate("files")}
            >
              <HardDrive className="h-4 w-4" /> Back up files
            </Button>
            {canRestore ? (
              <Button size="sm" variant="secondary" onClick={() => setRestoreTarget("upload")}>
                <Upload className="h-4 w-4" /> Upload &amp; restore
              </Button>
            ) : null}
          </div>
        }
      />

      {restoreTarget !== null ? (
        <RestoreDialog target={restoreTarget} onClose={() => setRestoreTarget(null)} />
      ) : null}

      {take.error ? <ErrorAlert className="mb-3" error={take.error} /> : null}
      {remove.error ? <ErrorAlert className="mb-3" error={remove.error} /> : null}

      {backups.isLoading ? (
        <Spinner />
      ) : backups.error ? (
        <ErrorAlert error={backups.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No backups yet"
          description="Take one now, or schedule automatic backups in Settings."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTime(b.createdAt)}</td>
                  <td className="px-3 py-2">{BACKUP_KIND_LABELS[b.kind]}</td>
                  <td className="px-3 py-2">
                    {b.status === "completed" ? (
                      <Badge tone="success">Completed</Badge>
                    ) : (
                      <span className="flex flex-col items-start gap-1">
                        <Badge tone="danger">Failed</Badge>
                        {/* Readable, not hovered: the reason a backup stopped
                            working was a tooltip on a screen nobody was looking
                            at — and unreachable entirely on a touchscreen. */}
                        {b.error ? (
                          <span className="max-w-md whitespace-pre-wrap break-words text-xs text-destructive">
                            {b.error}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    {humanSize(b.sizeBytes)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {b.createdByName ?? "Scheduled"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      {b.status === "completed" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Download"
                          onClick={() =>
                            void downloadBackup(b.id, `${b.kind}-${b.createdAt.slice(0, 10)}`)
                          }
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {b.hasLog ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Log for ${BACKUP_KIND_LABELS[b.kind]} backup`}
                          title="What this attempt said"
                          onClick={() =>
                            void downloadBackupLog(
                              b.id,
                              `backup-${b.kind}-${b.createdAt.slice(0, 10)}.log`,
                            )
                          }
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {b.status === "completed" && canRestore ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Restore"
                          onClick={() => setRestoreTarget(b)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete"
                        onClick={() => setConfirmDelete(b)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this backup?"
        description="The backup file is removed for good. This cannot be undone."
        confirmLabel="Delete backup"
        destructive
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete.id);
        }}
      />
    </>
  );
}
