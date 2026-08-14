// Author: Brijesh Dave <https://github.com/brijeshdave>
// Restoring a backup — the destructive action, so it is deliberately awkward: a superadmin
// must type RESTORE to arm it, and the copy spells out that it replaces current data. It
// handles both a stored backup and an uploaded file.
import { BACKUP_KIND_LABELS, type Backup, type BackupKind, formatDateTime } from "@reportly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileUp } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Alert, Input, Select, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { restoreBackup, restoreUpload } from "@/services/backups.js";

export function RestoreDialog({
  target,
  onClose,
}: {
  target: Backup | "upload";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<BackupKind>("database");
  const [done, setDone] = useState(false);

  const isUpload = target === "upload";

  const restore = useMutation({
    mutationFn: () => (isUpload ? restoreUpload(kind, file!) : restoreBackup(target.id)),
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries();
    },
  });

  const armed = confirm === "RESTORE" && (!isUpload || file !== null) && !restore.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/20" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restore a backup"
        className="relative flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h2 className="text-base font-semibold">
              Restore {isUpload ? "from a file" : BACKUP_KIND_LABELS[target.kind]}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This{" "}
              <strong>
                replaces the current{" "}
                {isUpload ? "data" : target.kind === "files" ? "uploaded files" : "database"}
              </strong>{" "}
              with the backup
              {isUpload ? " you upload" : ` taken ${formatDateTime(target.createdAt)}`}. It cannot
              be undone. A database restore drops and recreates objects, so do it in a quiet window.
            </p>
          </div>
        </div>

        {isUpload ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">What are you restoring?</span>
              <Select value={kind} onChange={(e) => setKind(e.target.value as BackupKind)}>
                <option value="database">Database (.dump)</option>
                <option value="files">Files (.tar.gz)</option>
              </Select>
            </label>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              <FileUp className="mr-1.5 h-4 w-4" />
              {file ? file.name : "Choose a backup file"}
            </Button>
          </>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Type <span className="font-mono">RESTORE</span> to confirm
          </span>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESTORE"
            autoFocus
          />
        </label>

        {restore.error ? <ErrorAlert error={restore.error} /> : null}
        {done ? <Alert tone="success">Restore complete. You may need to reload.</Alert> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={!armed}
              onClick={() => restore.mutate()}
            >
              {restore.isPending ? <Spinner /> : null}
              Restore
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
