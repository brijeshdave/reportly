// Author: Brijesh Dave <https://github.com/brijeshdave>
// Adding or correcting one end user — a page, not a modal, like the rest of the app.
//
// Two decisions are visible here rather than buried in the API. The employee number
// is required and unique, because it is the only thing that tells two people of the
// same name apart and the only thing an import can match on. And deleting is made
// deliberately hard once they are named on an entry: `inactive` is the answer, which
// takes them out of the journal's picker and leaves every entry about them intact.
import {
  PERMISSIONS,
  createEndUserSchema,
  type CreateEndUser,
  type EndUser,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { useToast } from "@/components/toaster.js";
import { Alert, Field, Input, Spinner, Textarea } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDepartments } from "@/services/departments.js";
import { createEndUser, deleteEndUser, fetchEndUser, updateEndUser } from "@/services/end-users.js";

/** What the form holds. Text as typed; the payload builder does the converting. */
interface EndUserForm {
  fullName: string;
  employeeNumber: string;
  departmentId: string;
  description: string;
  active: boolean;
}

export type EndUserEditorMode = "create" | "edit";

export function EndUserEditorPage({
  mode,
  endUserId,
}: {
  mode: EndUserEditorMode;
  endUserId?: string;
}) {
  const source = useQuery({
    queryKey: ["end-users", "detail", endUserId],
    queryFn: () => fetchEndUser(endUserId as string),
    enabled: mode === "edit" && Boolean(endUserId),
  });

  if (mode === "edit" && source.isLoading) return <Spinner />;
  if (mode === "edit" && source.error) return <ErrorAlert error={source.error} />;

  return <Editor mode={mode} person={source.data} />;
}

function Editor({ mode, person }: { mode: EndUserEditorMode; person?: EndUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: session } = useSuspenseQuery(sessionQuery);

  const [confirmDelete, setConfirmDelete] = useState(false);

  // This company's departments only: the record is created against the active
  // company, so a department from another one is not a choice the API would accept.
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const deptOptions = departmentOptions(
    (departments.data ?? [])
      .filter((d) => d.companyId === session.companyId)
      .map((d) => ({ value: d.id, name: d.name, path: d.path })),
  );

  const named = person?.entryCount ?? 0;

  const done = async (saved: EndUser) => {
    await queryClient.invalidateQueries({ queryKey: ["end-users"] });
    toast.saved(mode === "edit" ? "End user saved." : `${saved.fullName} added.`);
    if (mode !== "edit") {
      await navigate({ to: "/end-users/$endUserId/edit", params: { endUserId: saved.id } });
    }
  };

  // The route's own schema. Employee number is unique per company, which only the
  // server can know — that refusal now arrives named, and lands under the field.
  const form = useForm<EndUserForm, CreateEndUser>({
    schema: createEndUserSchema,
    initial: {
      fullName: person?.fullName ?? "",
      employeeNumber: person?.employeeNumber ?? "",
      departmentId: person?.departmentId ?? "",
      description: person?.description ?? "",
      active: (person?.status ?? "active") === "active",
    },
    toPayload: (v) => ({
      fullName: v.fullName.trim(),
      employeeNumber: v.employeeNumber.trim(),
      status: v.active ? "active" : "inactive",
      ...(v.departmentId === "" ? {} : { departmentId: v.departmentId }),
      ...(v.description.trim() === "" ? {} : { description: v.description.trim() }),
    }),
    submit: (input) =>
      mode === "edit"
        ? updateEndUser(person!.id, {
            ...input,
            // Explicitly null on an edit: an absent key leaves the stored value
            // alone, so clearing either of these would not stick.
            departmentId: input.departmentId ?? null,
            description: input.description ?? null,
          })
        : createEndUser(input),
    onSuccess: (saved) => done(saved as EndUser),
  });
  const { departmentId, active } = form.values;

  const remove = useMutation({
    mutationFn: () => deleteEndUser(person!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["end-users"] });
      toast.saved("End user deleted.");
      await navigate({ to: "/end-users" });
    },
  });

  const deactivating = mode === "edit" && person!.status === "active" && !active;
  const movingDepartment = mode === "edit" && (person!.departmentId ?? "") !== departmentId;

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit end user" : "New end user"}
        description={
          mode === "edit"
            ? "Every entry that names this person keeps pointing at this record, so a correction here corrects the reports too."
            : "Somebody your team supports, who does not use Reportly themselves."
        }
        actions={
          <div className="flex items-center gap-2">
            {mode === "edit" ? (
              <Can permission={PERMISSIONS.END_USERS_DELETE}>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </Can>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void navigate({ to: "/end-users" })}
            >
              Back
            </Button>
          </div>
        }
      />

      <Card className="mt-2 max-w-2xl p-6">
        <form ref={form.formRef} onSubmit={form.handleSubmit} className="flex flex-col gap-4">
          {/* Whatever could not be blamed on a field — a permission, a conflict. */}
          {form.formError ? <ErrorAlert error={form.formError} /> : null}
          {remove.error ? <ErrorAlert error={remove.error} /> : null}

          {mode === "edit" ? (
            <div className="flex items-center gap-2 text-sm">
              <Badge tone={named > 0 ? "brand" : "neutral"}>
                {named} {named === 1 ? "entry" : "entries"}
              </Badge>
              <span className="text-muted-foreground">
                {named === 0
                  ? "Nothing names this person yet — they can still be deleted."
                  : "name this person. Make them inactive rather than deleting them."}
              </span>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={form.errorFor("fullName")}>
              {(props) => (
                <Input
                  {...props}
                  {...form.register("fullName")}
                  autoFocus
                  disabled={form.submitting}
                  placeholder="e.g. Anita Sharma"
                />
              )}
            </Field>

            <Field
              label="Employee number"
              required
              error={form.errorFor("employeeNumber")}
              hint="Unique in this company. It is what tells two people of the same name apart, and what an import matches on."
            >
              {(props) => (
                <Input
                  {...props}
                  {...form.register("employeeNumber")}
                  disabled={form.submitting}
                  placeholder="e.g. EMP-1042"
                />
              )}
            </Field>

            <Field
              label="Department"
              hint="The journal offers this person once their department is chosen on the entry. Leave it empty for a contractor or a visitor."
            >
              {(props) => (
                <SearchableSelect
                  id={props.id}
                  aria-describedby={props["aria-describedby"]}
                  value={departmentId}
                  onChange={(next) => form.set("departmentId", next)}
                  options={deptOptions}
                  placeholder="No department"
                  disabled={form.submitting}
                />
              )}
            </Field>

            <Field
              label="Status"
              hint="Inactive keeps their history and takes them out of the picker."
            >
              {() => (
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => form.set("active", event.target.checked)}
                    disabled={form.submitting}
                  />
                  Offered in the journal
                </label>
              )}
            </Field>
          </div>

          {/* Moving somebody changes which entries can name them from now on, and it
              is the sort of edit that is easy to make by accident in a long list. */}
          {movingDepartment && named > 0 ? (
            <Alert tone="info">
              Their {named} existing {named === 1 ? "entry" : "entries"} stay as they are. The
              department decides who the journal offers next time, not what was filed before.
            </Alert>
          ) : null}

          {deactivating ? (
            <Alert tone="info">
              {named > 0
                ? `Their ${named} ${named === 1 ? "entry" : "entries"} stay exactly as filed and keep appearing in the reports — they simply stop being offered on new ones.`
                : "They stop being offered on new entries. Nothing else changes."}
            </Alert>
          ) : null}

          <Field
            label="Notes"
            error={form.errorFor("description")}
            hint="Anything worth knowing — where they sit, which shift, the machine they always use."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                {...form.register("description")}
                disabled={form.submitting}
                placeholder="e.g. Accounts, 2nd floor — uses the shared printer by the lift"
              />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/end-users" })}
              disabled={form.submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={form.submitting}>
              {form.submitting ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Add end user"}
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${person?.fullName}?`}
        description={
          named > 0
            ? `${named} ${named === 1 ? "entry names" : "entries name"} this person, so the deletion will be refused — it would leave those entries pointing at nobody and take them out of every report. Make them inactive instead: the history stays, and the journal stops offering them.`
            : "Nothing names this person, so nothing is lost."
        }
        confirmLabel="Delete end user"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
