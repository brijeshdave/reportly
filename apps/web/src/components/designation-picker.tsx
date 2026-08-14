// Author: Brijesh Dave <https://github.com/brijeshdave>
// Choose a job title from the catalogue, rather than typing one.
//
// Typing produced "Sr. Engineer", "Senior Engineer" and "Senior engineer" as three
// different jobs, which is why this is a list now. The one wrinkle is a *retired*
// title: it is not offered to anybody new, but somebody may already hold it — so if
// this person does, it is still shown, marked, and kept unless they are moved off
// it. A picker that silently dropped it would erase their job title the first time
// anyone opened their profile and pressed save.
import { useQuery } from "@tanstack/react-query";

import { Spinner } from "@/components/ui/form.js";
import { fetchDesignationOptions } from "@/services/designations.js";

export function DesignationPicker({
  value,
  currentName,
  onChange,
  disabled = false,
  label = "Designation",
}: {
  /** The designation they hold, or null. */
  value: string | null;
  /** Its name — needed when it is retired and therefore not in the options. */
  currentName?: string | null;
  onChange: (designationId: string | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const options = useQuery({
    queryKey: ["designations", "options"],
    queryFn: fetchDesignationOptions,
  });

  if (options.isLoading) return <Spinner />;

  const list = options.data ?? [];
  const retired = value !== null && currentName && !list.some((option) => option.id === value);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={disabled}
        aria-label={label}
        className="h-10 rounded-xl border border-border bg-card px-3 text-sm disabled:opacity-50"
      >
        <option value="">None</option>

        {/* Held but no longer offered: shown so that saving does not wipe it. */}
        {retired ? <option value={value}>{currentName} (retired)</option> : null}

        {list.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      {list.length === 0 && !retired ? (
        <span className="text-xs text-muted-foreground">
          No designations yet — an administrator adds them under Designations.
        </span>
      ) : null}
    </label>
  );
}
