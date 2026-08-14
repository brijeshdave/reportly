// Author: Brijesh Dave <https://github.com/brijeshdave>
// Bulk-building the asset tree from a spreadsheet. Download the template, fill each row
// with a full path (e.g. `Kim › Line 1 › Station A`), upload it. The server is
// all-or-nothing: a file with any bad row writes nothing and returns the problems per
// line, so this dialog shows those clearly and lets the person fix and retry.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Alert, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { type AssetImportOutcome, downloadAssetTemplate, importAssets } from "@/services/assets.js";

export function AssetImportDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<AssetImportOutcome | null>(null);

  const upload = useMutation({
    mutationFn: () => importAssets(file!),
    onSuccess: async (result) => {
      setOutcome(result);
      if (result.created > 0 || result.updated > 0) {
        await queryClient.invalidateQueries({ queryKey: ["assets"] });
      }
    },
  });

  const wrote =
    outcome !== null &&
    outcome.problems.length === 0 &&
    (outcome.created > 0 || outcome.updated > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/20" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import assets"
        className="relative flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div>
          <h2 className="text-base font-semibold">Import assets</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each row is a full path from the root — missing parents are created, and an existing
            path has its type, site and status updated. Type and Site are matched by name; leave
            Site blank on a child to inherit its parent's. If any row is wrong, nothing is saved.
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={() => void downloadAssetTemplate()}>
          <Download className="mr-1.5 h-4 w-4" />
          Download template (.xlsx)
        </Button>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setOutcome(null);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            <FileUp className="mr-1.5 h-4 w-4" />
            {file ? file.name : "Choose a .xlsx or .csv file"}
          </Button>
        </div>

        {upload.error ? <ErrorAlert error={upload.error} /> : null}

        {outcome ? (
          wrote ? (
            <Alert tone="success">
              {outcome.created} created, {outcome.updated} updated.
            </Alert>
          ) : outcome.problems.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Alert tone="error">
                Nothing was saved — fix these {outcome.problems.length} row
                {outcome.problems.length === 1 ? "" : "s"} and upload again.
              </Alert>
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-border text-sm">
                {outcome.problems.map((p, i) => (
                  <li
                    key={`${p.line}-${i}`}
                    className="flex gap-2 border-b border-border/60 px-3 py-1.5 last:border-0"
                  >
                    <span className="shrink-0 font-medium text-muted-foreground">Row {p.line}</span>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Alert tone="info">Nothing to import — the file had no rows.</Alert>
          )
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {wrote ? "Close" : "Cancel"}
          </Button>
          {!wrote ? (
            <Button size="sm" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
              {upload.isPending ? <Spinner /> : <Upload className="mr-1.5 h-4 w-4" />}
              Import
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
