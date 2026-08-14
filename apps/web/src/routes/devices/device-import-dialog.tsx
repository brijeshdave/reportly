// Author: Brijesh Dave <https://github.com/brijeshdave>
// Bulk-registering devices from a spreadsheet. Download the template, fill it, upload
// it. The server is all-or-nothing: a file with any bad row writes nothing and
// returns the problems per line, so this dialog's job is to show those clearly and
// let the person fix the file and try again — not to pretend a rejected file worked.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Alert, Select, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { fetchDepartments } from "@/services/departments.js";
import {
  type DeviceImportOutcome,
  downloadDeviceTemplate,
  importDevices,
} from "@/services/assets.js";

/** Flatten the department tree so every one is offered, nesting shown by indent. */
function flattenDepartments(
  nodes: { id: string; name: string; children?: unknown[] }[],
  depth = 0,
): { id: string; label: string }[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${"— ".repeat(depth)}${node.name}` },
    ...flattenDepartments(
      (node.children ?? []) as { id: string; name: string; children?: unknown[] }[],
      depth + 1,
    ),
  ]);
}

export function DeviceImportDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [departmentId, setDepartmentId] = useState<string>("");
  const [outcome, setOutcome] = useState<DeviceImportOutcome | null>(null);

  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  const upload = useMutation({
    mutationFn: () => importDevices(file!, departmentId || null),
    onSuccess: async (result) => {
      setOutcome(result);
      if (result.created > 0) {
        await queryClient.invalidateQueries({ queryKey: ["devices"] });
      }
    },
  });

  const done = outcome !== null && outcome.created > 0 && outcome.problems.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/20" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import devices"
        className="relative flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div>
          <h2 className="text-base font-semibold">Import devices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every device goes into the department you choose, and each row's type is matched within
            it. Every row needs a Site; the asset it "lives at" is optional. Sites and assets are
            matched by name. If any row is wrong, nothing is saved and you will see what to fix.
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Department</span>
          <Select
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setOutcome(null);
            }}
          >
            <option value="">No department (leave the Type column blank)</option>
            {flattenDepartments(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            Types belong to a department, so the whole import goes into one.
          </span>
        </label>

        <Button variant="secondary" size="sm" onClick={() => void downloadDeviceTemplate()}>
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
          done ? (
            <Alert tone="success">
              {outcome.created} device{outcome.created === 1 ? "" : "s"} imported.
            </Alert>
          ) : outcome.created > 0 ? (
            <Alert tone="info">
              {outcome.created} imported. {/* mixed results cannot happen — all or nothing */}
            </Alert>
          ) : (
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
          )
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done ? (
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
