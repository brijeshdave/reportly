// Author: Brijesh Dave <https://github.com/brijeshdave>
// Renders one setting as a form, generated from its Zod schema. Adding a setting
// to the shared registry is enough to make it editable here — there is no
// hand-written form that can drift from the schema that validates the write.
import { describeSettingSchema, type SettingDef, type SettingField } from "@reportly/shared";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select.js";
import { Alert, Field, Input, Spinner, Textarea } from "@/components/ui/form.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";

type SettingValue = Record<string, unknown>;

const SELECT_CLASS =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** A `Record<string, enum>` field, e.g. per-feature log levels. */
function RecordField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: Record<string, string | number>;
  onChange: (next: Record<string, string | number>) => void;
  disabled?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const options = field.options ?? [];
  // A record's values are an enum (log levels) or a number (retention days). The
  // form only ever drew the `<select>`, so a numeric record rendered a control
  // with no options: a key you could add and a value you could never set.
  const numeric = field.valueKind === "number";
  const suggestions = field.keyOptions ?? [];
  // What is left to add — a name already overridden is not a suggestion.
  const remaining = suggestions.filter((name) => !(name in value));
  const listId = useId();

  const add = () => {
    const key = newKey.trim();
    if (key === "" || key in value) return;
    onChange({ ...value, [key]: numeric ? (field.min ?? 0) : (options[0] ?? "") });
    setNewKey("");
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{field.label}</span>

      {Object.entries(value).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {/* The copy used to talk about logging, because log levels were the only
              record setting. It is the same control for message retention, where
              "every area logs at the default" means nothing. */}
          No overrides — everything follows the defaults above. Add one to change a single entry
          without touching the rest.
        </p>
      ) : null}

      {Object.entries(value).map(([key, entry]) => (
        <div key={key} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1 text-xs">
            {key}
          </code>
          {numeric ? (
            <Input
              type="number"
              aria-label={`${field.label} for ${key}`}
              value={String(entry)}
              min={field.min}
              max={field.max}
              step={field.integer ? 1 : undefined}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
              className="h-8 w-32"
            />
          ) : (
            <select
              aria-label={`${field.label} for ${key}`}
              value={String(entry)}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              className={`${SELECT_CLASS} h-8 w-32`}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${key}`}
            disabled={disabled}
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        {/* `min-w-0` is doing real work here: without it the input refuses to
            shrink below its content, overflows the flex row, and rides over the
            Add button as soon as you type. The rows above already carry it. */}
        <div className="min-w-0 flex-1">
          <Input
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            placeholder={
              suggestions.length > 0 ? `e.g. ${suggestions[1] ?? suggestions[0]}` : "Name"
            }
            aria-label={`Add an override to ${field.label}`}
            disabled={disabled}
            list={suggestions.length > 0 ? listId : undefined}
            className="h-8 w-full"
          />
          {/* A datalist, not a select: the map takes any string on purpose, so a
              feature the list has not heard of must stay typeable. This offers
              the known ones without closing the door on the rest. */}
          {suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          ) : null}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={disabled || newKey === ""}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {suggestions.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Known: {remaining.length > 0 ? remaining.join(", ") : "all already overridden"}
        </p>
      ) : null}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.kind === "list") {
    // One per line, because the values are things like MIME types and hostnames —
    // commas would need escaping the first time somebody pastes one containing a
    // comma, and a newline never appears inside these.
    //
    // Blank lines are dropped rather than saved: a trailing newline is what a
    // textarea gives you for pressing enter, not an empty item somebody meant.
    const items = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Field label={field.label} hint="One per line. Leave empty to accept anything.">
        {(props) => (
          <Textarea
            {...props}
            rows={Math.min(Math.max(items.length + 1, 3), 12)}
            value={items.join("\n")}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== ""),
              )
            }
          />
        )}
      </Field>
    );
  }

  if (field.kind === "record") {
    return (
      <RecordField
        field={field}
        value={(value as Record<string, string>) ?? {}}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  // A string the runtime enumerates: hundreds of choices, so a searchable list
  // rather than a `<select>` — and rather than a text box, where "Asia/Kolkatta"
  // is only refused on save, which is a poor way to learn the spelling.
  if (field.optionSource === "timezones") {
    return (
      // "Name" is what the schema key humanises to, and means nothing here.
      <Field label="Timezone" hint="Your working day. Search by city or region.">
        {(props) => (
          <SearchableSelect
            {...props}
            value={String(value ?? "")}
            onChange={onChange}
            options={timezoneOptions()}
            disabled={disabled}
            ariaLabel="Timezone"
            placeholder="Choose a timezone"
          />
        )}
      </Field>
    );
  }

  if (field.kind === "enum") {
    return (
      <Field label={field.label}>
        {(props) => (
          <select
            {...props}
            value={String(value ?? "")}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={SELECT_CLASS}
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  }

  if (field.kind === "number") {
    const hint = [
      field.min !== undefined ? `min ${field.min}` : null,
      field.max !== undefined ? `max ${field.max}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return (
      <Field label={field.label} hint={hint || undefined}>
        {(props) => (
          <Input
            {...props}
            type="number"
            value={String(value ?? "")}
            min={field.min}
            max={field.max}
            step={field.integer ? 1 : "any"}
            disabled={disabled}
            // An empty input is not zero; keep it empty so the field can be cleared.
            onChange={(event) =>
              onChange(event.target.value === "" ? "" : Number(event.target.value))
            }
          />
        )}
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      {(props) => (
        <Input
          {...props}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * Every timezone this browser knows, newest list wins.
 *
 * From the runtime rather than a list shipped in the app: zone names and their
 * rules change with each tzdata release, and a hard-coded list would quietly go
 * stale between releases. `supportedValuesOf` is not in older engines, so UTC is
 * the floor — a box with one right answer beats a crash.
 */
function timezoneOptions(): { value: string; label: string }[] {
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")].map((zone) => ({
    value: zone,
    label: zone.replace(/_/g, " "),
  }));
}

export function SettingForm({
  def,
  value,
  onSave,
  disabled,
}: {
  def: SettingDef;
  value: SettingValue;
  onSave: (next: SettingValue) => Promise<unknown>;
  disabled?: boolean;
}) {
  const fields = describeSettingSchema(def.schema).map((f) =>
    // The schema cannot say what a record's keys should be — a plain string key
    // accepts anything — so the setting declares its suggestions and they are
    // attached here.
    f.kind === "record" && def.keyOptions?.[f.key]
      ? { ...f, keyOptions: def.keyOptions[f.key] }
      : // The same attaching for a string whose choices come from the runtime.
        // Declaring the branch that renders it without wiring this left the field
        // a plain text box — the setting said "choose from a list" and the screen
        // never heard.
        def.optionSource?.[f.key]
        ? { ...f, optionSource: def.optionSource[f.key] }
        : f,
  );
  const [draft, setDraft] = useState<SettingValue>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync when the server's value changes (a refetch, another admin).
  useEffect(() => setDraft(value), [value]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (cause) {
      // The schema rejects out-of-range values; show what it said.
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold">
        {def.namespace}.{def.key}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{def.description}</p>

      <div className="mt-4 flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {saved && !dirty ? <Alert tone="success">Saved. Applies immediately.</Alert> : null}

        {fields.map((field) => (
          <FieldControl
            key={field.key}
            field={field}
            value={draft[field.key]}
            disabled={disabled || busy}
            onChange={(next) => {
              setSaved(false);
              setDraft((current) => ({ ...current, [field.key]: next }));
            }}
          />
        ))}

        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={disabled || busy || !dirty}>
            {busy ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}
