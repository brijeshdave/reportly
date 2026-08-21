// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tags, owned by a department. Free labels for finding work later — as many per
// report as apply, unlike the category, which is the single "what kind of problem
// is this" and is what the recurring-issue analytics counts by.
//
// A new tag arrives already coloured (the server picks from a twenty-hue palette,
// preferring one the department is not using), so the common case is type-a-name-
// and-go. The colour is editable for anyone who wants to organise by it.
import { TAG_COLORS, type TagRow } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Trash2 } from "lucide-react";
import { useState } from "react";

import { TagChip } from "@/components/tag-chip.js";
import { departmentOptions } from "@/lib/department-options.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { Button, Card, EmptyState } from "@/components/ui/primitives.js";
import { fetchDepartments } from "@/services/departments.js";
import { createTag, deleteTag, fetchTags, updateTag } from "@/services/vocabulary.js";

export function TagsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: ["departments", "list"], queryFn: fetchDepartments });

  const [departmentId, setDepartmentId] = useState<string>("");
  const active = departmentId || departments.data?.[0]?.id || "";

  const tags = useQuery({
    queryKey: ["vocabulary", "tags", active],
    queryFn: () => fetchTags(active),
    enabled: Boolean(active),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["vocabulary", "tags", active] });

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("");
  const create = useMutation({
    // No colour sent means the server picks one — which is the path most people
    // will take, so it must be the one that needs no thought.
    mutationFn: () =>
      createTag({
        departmentId: active,
        name: name.trim(),
        status: "active",
        ...(color ? { color } : {}),
      }),
    onSuccess: async () => {
      setName("");
      setColor("");
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
        description="Tags belong to a department. Create a department first, in the company whose org you're setting up."
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

      {tags.isLoading ? <Spinner /> : null}
      {tags.error ? <ErrorAlert error={tags.error} /> : null}

      <Card className="divide-y divide-border">
        <div className="grid grid-cols-[1fr_5rem_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Tag</span>
          <span>Status</span>
          <span />
        </div>
        {(tags.data ?? []).length === 0 && !tags.isLoading ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No tags in this department yet.</p>
        ) : null}
        {(tags.data ?? []).map((tag) => (
          <TagRowItem key={tag.id} tag={tag} canManage={canManage} onChange={refresh} />
        ))}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Add a tag</h3>
          {create.error ? <ErrorAlert error={create.error} /> : null}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. safety"
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
          <ColorPicker
            value={color}
            onChange={setColor}
            hint="Leave unset and one is chosen for you."
          />
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The twenty palette colours as swatches, plus a native colour input for anything
 * else. `""` means "let the server decide", which is a real third state rather
 * than a default value — so the create form does not have to pretend to know what
 * colour a tag will be before it exists.
 */
function ColorPicker({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (color: string) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Colour {hint ? `— ${hint}` : ""}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {TAG_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Use ${swatch}`}
            aria-pressed={value === swatch}
            onClick={() => onChange(value === swatch ? "" : swatch)}
            style={{ backgroundColor: swatch }}
            className={
              "h-6 w-6 rounded-full border transition " +
              (value === swatch
                ? "border-foreground ring-2 ring-ring ring-offset-1 ring-offset-background"
                : "border-transparent hover:scale-110")
            }
          />
        ))}
        <label className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>Custom</span>
          <input
            type="color"
            aria-label="Custom colour"
            value={value || "#64748b"}
            onChange={(event) => onChange(event.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
          />
        </label>
      </div>
    </div>
  );
}

function TagRowItem({
  tag,
  canManage,
  onChange,
}: {
  tag: TagRow;
  canManage: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [editingColor, setEditingColor] = useState(false);
  const active = tag.status === "active";

  const save = useMutation({
    mutationFn: (patch: { name?: string; color?: string; status?: "active" | "inactive" }) =>
      updateTag(tag.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: () => deleteTag(tag.id), onSuccess: onChange });

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={`Change colour of ${tag.name}`}
            onClick={() => canManage && setEditingColor((open) => !open)}
            disabled={!canManage}
            style={{ backgroundColor: tag.color }}
            className="h-5 w-5 shrink-0 rounded-full border border-border disabled:cursor-default"
          />
          {canManage ? (
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => name.trim() && name !== tag.name && save.mutate({ name: name.trim() })}
            />
          ) : (
            <TagChip name={tag.name} color={tag.color} />
          )}
        </div>

        <button
          type="button"
          disabled={!canManage || save.isPending}
          onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
          className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline"
          // Retiring is the safe counterpart to deleting: the records already
          // carrying this tag keep it, and it stops being offered on new ones.
          title={active ? "Retire this tag" : "Bring this tag back"}
        >
          {active ? "Active" : "Retired"}
        </button>

        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete ${tag.name}`}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <span />
        )}
      </div>

      {editingColor && canManage ? (
        <ColorPicker
          value={tag.color}
          onChange={(color) => {
            save.mutate({ color });
            setEditingColor(false);
          }}
        />
      ) : null}

      {save.error ? <ErrorAlert error={save.error} /> : null}
      {/* A tag in use cannot be deleted — the message says to retire it instead. */}
      {remove.error ? <ErrorAlert error={remove.error} /> : null}
    </div>
  );
}
