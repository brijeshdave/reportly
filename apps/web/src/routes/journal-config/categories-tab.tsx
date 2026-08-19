// Author: Brijesh Dave <https://github.com/brijeshdave>
// Categories, owned by a department. Pick a department, then manage its categories —
// two departments may each have a "Safety" and mean different things, so they never
// collide across the company.
import { type CategoryRow } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Trash2 } from "lucide-react";
import { useState } from "react";

import { Input, Spinner } from "@/components/ui/form.js";
import { departmentOptions } from "@/lib/department-options.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives.js";
import { fetchDepartments } from "@/services/departments.js";
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from "@/services/journal-config.js";

export function CategoriesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: ["departments", "list"], queryFn: fetchDepartments });

  const [departmentId, setDepartmentId] = useState<string>("");
  const active = departmentId || departments.data?.[0]?.id || "";

  const categories = useQuery({
    queryKey: ["report-config", "categories", active],
    queryFn: () => fetchCategories(active),
    enabled: Boolean(active),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["report-config", "categories", active] });

  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => createCategory({ departmentId: active, name: name.trim(), status: "active" }),
    onSuccess: async () => {
      setName("");
      await refresh();
    },
  });

  if (departments.isLoading) return <Spinner />;
  if (departments.error) return <ErrorAlert error={departments.error} />;

  if ((departments.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No departments yet"
        description="Categories belong to a department. Create a department first, in the company whose org you're setting up."
      />
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <label className="flex max-w-xs flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Department</span>
        {/* Searchable, with each department's parents underneath — the same picker
            as everywhere else a department is chosen. */}
        <SearchableSelect
          ariaLabel="Department"
          value={active}
          onChange={setDepartmentId}
          options={departmentOptions(
            (departments.data ?? []).map((d) => ({ value: d.id, name: d.name, path: d.path })),
          )}
          placeholder="Choose a department…"
        />
      </label>

      {categories.isLoading ? <Spinner /> : null}
      {categories.error ? <ErrorAlert error={categories.error} /> : null}

      <Card className="divide-y divide-border">
        <div className="grid grid-cols-[1fr_5rem_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Category</span>
          <span>Status</span>
          <span />
        </div>
        {(categories.data ?? []).length === 0 && !categories.isLoading ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No categories in this department yet.
          </p>
        ) : null}
        {(categories.data ?? []).map((category) => (
          <CategoryRowItem
            key={category.id}
            category={category}
            canManage={canManage}
            onChange={refresh}
          />
        ))}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Add a category</h3>
          {create.error ? <ErrorAlert error={create.error} /> : null}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Mechanical breakdown"
              />
            </div>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending || name.trim() === ""}
            >
              {create.isPending ? <Spinner /> : null}
              Add
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function CategoryRowItem({
  category,
  canManage,
  onChange,
}: {
  category: CategoryRow;
  canManage: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState(category.name);
  const active = category.status === "active";

  const save = useMutation({
    mutationFn: (patch: { name?: string; status?: "active" | "inactive" }) =>
      updateCategory(category.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => deleteCategory(category.id),
    onSuccess: onChange,
  });

  if (!canManage) {
    return (
      <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
        <span className="font-medium">{category.name}</span>
        <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
        <span />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
      <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
      <button
        type="button"
        onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
        title={active ? "Retire" : "Reactivate"}
      >
        <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
      </button>
      <div className="flex items-center gap-1">
        {name.trim() !== category.name ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => save.mutate({ name: name.trim() })}
            disabled={save.isPending}
          >
            Save
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${category.name}`}
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
