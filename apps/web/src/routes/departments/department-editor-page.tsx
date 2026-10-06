// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating and editing a department on a full page, not a modal — the pattern the
// rest of the app follows. A department has a name and an optional parent, which
// is where it sits in the org tree; the parent list excludes the department itself
// and its descendants so the tree cannot fold back on itself.
import {
  createDepartmentSchema,
  type CreateDepartment,
  type Department,
  type DepartmentNode,
} from "@reportly/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Field, Input, Spinner } from "@/components/ui/form.js";
import { useForm } from "@/hooks/use-form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import {
  createDepartment,
  fetchDepartment,
  fetchDepartments,
  updateDepartment,
} from "@/services/departments.js";

export type DepartmentEditorMode = "create" | "edit";

/** The ids a department may not be parented under: itself and its descendants. */
function forbiddenParents(nodes: DepartmentNode[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node.id);
    childrenOf.set(node.parentId, list);
  }
  const forbidden = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!forbidden.has(child)) {
        forbidden.add(child);
        stack.push(child);
      }
    }
  }
  return forbidden;
}

export function DepartmentEditorPage({
  mode,
  departmentId,
}: {
  mode: DepartmentEditorMode;
  departmentId?: string;
}) {
  const department = useQuery({
    queryKey: ["departments", "detail", departmentId],
    queryFn: () => fetchDepartment(departmentId as string),
    enabled: mode === "edit" && Boolean(departmentId),
  });
  const list = useQuery({ queryKey: ["departments", "list"], queryFn: fetchDepartments });

  if (mode === "edit" && department.isLoading) return <Spinner />;
  if (mode === "edit" && department.error) return <ErrorAlert error={department.error} />;
  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorAlert error={list.error} />;

  return <Editor mode={mode} department={department.data} all={list.data ?? []} />;
}

function Editor({
  mode,
  department,
  all,
}: {
  mode: DepartmentEditorMode;
  department?: Department;
  all: DepartmentNode[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const forbidden =
    mode === "edit" && department ? forbiddenParents(all, department.id) : new Set<string>();
  const parentOptions = all.filter((node) => !forbidden.has(node.id));

  const done = async (id: string) => {
    await queryClient.invalidateQueries({ queryKey: ["departments"] });
    await navigate({ to: "/departments/$departmentId", params: { departmentId: id } });
  };

  // The route's own schema, so the form refuses what the API refuses and says so
  // under the field rather than above the whole form.
  const form = useForm<{ name: string; parentId: string }, CreateDepartment>({
    schema: createDepartmentSchema,
    initial: { name: department?.name ?? "", parentId: department?.parentId ?? "" },
    toPayload: (v) => ({ name: v.name.trim(), parentId: v.parentId === "" ? null : v.parentId }),
    submit: (input) =>
      mode === "edit" ? updateDepartment(department!.id, input) : createDepartment(input),
    onSuccess: (created) => done((created as { id: string }).id),
  });

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit department" : "New department"}
        description={
          mode === "edit"
            ? "Rename it, or move it under a different parent in the org tree."
            : "Give it a name and, optionally, a parent department it sits under."
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigate({ to: "/departments" })}
          >
            Back to departments
          </Button>
        }
      />

      <Card className="mt-2 max-w-lg p-6">
        <form ref={form.formRef} onSubmit={form.handleSubmit} className="flex flex-col gap-4">
          {/* Whatever could not be blamed on a field — a permission, a conflict. */}
          {form.formError ? <ErrorAlert error={form.formError} /> : null}

          <Field label="Name" required error={form.errorFor("name")}>
            {(props) => (
              <Input {...props} {...form.register("name")} autoFocus disabled={form.submitting} />
            )}
          </Field>

          <Field label="Parent department" error={form.errorFor("parentId")}>
            {(props) => (
              <select
                {...props}
                {...form.register("parentId")}
                disabled={form.submitting}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
              >
                <option value="">None (top-level)</option>
                {/* The full path: a native option has no second line to put the
                    ancestors on, so they go in the label itself. */}
                {parentOptions.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.path}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/departments" })}
              disabled={form.submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={form.submitting}>
              {form.submitting ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create department"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
