// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating and editing a job title — a page, not a modal, following the rest of the
// app. Editing is where the head-count earns its keep: it is what tells you a rename
// is about to change what half a department is called, and whether a delete is even
// possible.
import { PERMISSIONS, type DesignationRow } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import {
  createDesignation,
  deleteDesignation,
  fetchDesignation,
  updateDesignation,
} from "@/services/designations.js";

export type DesignationEditorMode = "create" | "edit";

export function DesignationEditorPage({
  mode,
  designationId,
}: {
  mode: DesignationEditorMode;
  designationId?: string;
}) {
  const source = useQuery({
    queryKey: ["designations", "detail", designationId],
    queryFn: () => fetchDesignation(designationId as string),
    enabled: mode === "edit" && Boolean(designationId),
  });

  if (mode === "edit" && source.isLoading) return <Spinner />;
  if (mode === "edit" && source.error) return <ErrorAlert error={source.error} />;

  return <Editor mode={mode} designation={source.data} />;
}

function Editor({
  mode,
  designation,
}: {
  mode: DesignationEditorMode;
  designation?: DesignationRow;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(designation?.name ?? "");
  const [active, setActive] = useState((designation?.status ?? "active") === "active");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const held = designation?.userCount ?? 0;

  const done = async () => {
    // A rename changes what every holder is called, so their pages are stale too.
    await queryClient.invalidateQueries({ queryKey: ["designations"] });
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    await queryClient.invalidateQueries({ queryKey: ["departments"] });
    await navigate({ to: "/designations" });
  };

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        status: active ? ("active" as const) : ("inactive" as const),
      };
      return mode === "edit" ? updateDesignation(designation!.id, input) : createDesignation(input);
    },
    onSuccess: done,
  });

  const remove = useMutation({
    mutationFn: () => deleteDesignation(designation!.id),
    onSuccess: done,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const renamed = mode === "edit" && name.trim() !== designation!.name;
  const retiring = mode === "edit" && designation!.status === "active" && !active;

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit designation" : "New designation"}
        description={
          mode === "edit"
            ? "Renaming it corrects everybody holding it. Retiring it stops it being offered, without taking it from anyone."
            : "A job title your people can be given."
        }
        actions={
          <div className="flex items-center gap-2">
            {mode === "edit" ? (
              <Can permission={PERMISSIONS.DESIGNATIONS_DELETE}>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </Can>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void navigate({ to: "/designations" })}
            >
              Back
            </Button>
          </div>
        }
      />

      <Card className="mt-2 max-w-lg p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {save.error ? <ErrorAlert error={save.error} /> : null}
          {remove.error ? <ErrorAlert error={remove.error} /> : null}

          {mode === "edit" ? (
            <div className="flex items-center gap-2 text-sm">
              <Badge tone={held > 0 ? "brand" : "neutral"}>
                {held} {held === 1 ? "person" : "people"}
              </Badge>
              <span className="text-muted-foreground">
                {held === 0 ? "Nobody holds this — it can be deleted." : "hold this designation."}
              </span>
            </div>
          ) : null}

          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                disabled={save.isPending}
                placeholder="e.g. Senior Engineer"
              />
            )}
          </Field>

          {/* A rename is not a local edit — say whose job title is about to change. */}
          {renamed && held > 0 ? (
            <Alert tone="info">
              This renames the title of {held} {held === 1 ? "person" : "people"} — they point at
              this entry rather than each carrying their own copy of the words.
            </Alert>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              disabled={save.isPending}
            />
            Offered to new users
          </label>

          {retiring ? (
            <Alert tone="info">
              {held > 0
                ? `The ${held} ${held === 1 ? "person" : "people"} holding it keep it — it simply stops being offered to anybody new.`
                : "It stops being offered. Nothing else changes."}
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/designations" })}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending || name.trim() === ""}>
              {save.isPending ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create designation"}
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${designation?.name}?`}
        description={
          held > 0
            ? `${held} ${held === 1 ? "person holds" : "people hold"} this designation, so it cannot be deleted — deleting it would strip the job title from every one of them. Retire it instead: they keep it, and nobody new is offered it.`
            : "Nobody holds this designation, so nothing is lost."
        }
        confirmLabel="Delete designation"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
