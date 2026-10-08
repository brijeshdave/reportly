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
import { useForm, type ParsesInto } from "@/hooks/use-form.js";
import { errorMessage } from "@/lib/error-message.js";

type SettingValue = Record<string, unknown>;

const SELECT_CLASS =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/**
 * A refusal in words, from the field's own description.
 *
 * The registry's schemas carry bounds but no messages, so what they say is
 * "Too big: expected number to be <=128" — the machine wording the per-field
 * errors were meant to replace, wearing a different hat. Writing a message onto
 * every schema in the registry would mean remembering to do it for every setting
 * added later; this form is generated from the schema, so the message is too, from
 * the same `min`/`max`/`integer` the hint beside the box already reads.
 *
 * The schema stays the judge of whether a value is allowed. This only decides how
 * to say so, and hands back the schema's own words for anything it cannot phrase —
 * a cross-field refine, a string pattern — rather than inventing one.
 */
function readableError(
  field: SettingField,
  value: unknown,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined || field.kind !== "number") return raw;
  // An emptied box arrives as "", which is the commonest way to see this.
  if (value === "" || value === null || value === undefined) return "Type a number.";
  if (typeof value !== "number" || Number.isNaN(value)) return "Type a number.";
  if (field.integer && !Number.isInteger(value)) return "Whole numbers only.";
  if (field.min !== undefined && value < field.min) return `${field.min} or more.`;
  if (field.max !== undefined && value > field.max) return `${field.max} or less.`;
  return raw;
}

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
  error,
}: {
  field: SettingField;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** What the setting's own schema said about this field, if anything. */
  error?: string;
}) {
  if (field.kind === "boolean") {
    return (
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          {field.label}
        </label>
        {/* A tickbox rarely has anything to say, but a schema that refines across
            fields can land on one, and it had nowhere to put it. */}
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
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
      <Field label={field.label} error={error} hint="One per line. Leave empty to accept anything.">
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
      <div>
        <RecordField
          field={field}
          value={(value as Record<string, string>) ?? {}}
          onChange={onChange}
          disabled={disabled}
        />
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  // A string the runtime enumerates: hundreds of choices, so a searchable list
  // rather than a `<select>` — and rather than a text box, where "Asia/Kolkatta"
  // is only refused on save, which is a poor way to learn the spelling.
  if (field.optionSource === "timezones") {
    return (
      // "Name" is what the schema key humanises to, and means nothing here.
      <Field label="Timezone" error={error} hint="Your working day. Search by city or region.">
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
      <Field label={field.label} error={error}>
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
      <Field label={field.label} error={error} hint={hint || undefined}>
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
    <Field label={field.label} error={error}>
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
  const [saved, setSaved] = useState(false);

  /**
   * Validated against the setting's own schema — the same object the write is
   * parsed with on the server, which is the whole premise of this page.
   *
   * It used to be checked only there, so a retention of 9999 days came back as one
   * sentence above a card of eight inputs, naming a field in the words the schema
   * happened to use. Every setting in the registry gains a message at its own field
   * from this, including the ones nobody has added yet.
   *
   * What is sent is the schema's own parse of the draft, not the draft itself.
   * That is the same object the server would have produced from it, so nothing new
   * is written — and it is the only form the type checker can offer here, since
   * reaching back for the draft would make the form's type depend on itself.
   */
  const form = useForm<SettingValue, SettingValue>({
    schema: def.schema as unknown as ParsesInto<SettingValue>,
    initial: value,
    submit: (next) => onSave(next),
    onSuccess: () => setSaved(true),
  });
  const draft = form.values;

  // Re-sync when the server's value changes (a refetch, another admin).
  useEffect(() => form.reset(value), [value]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold">
        {def.namespace}.{def.key}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{def.description}</p>

      {/* Nested rather than replacing the card: `Card` takes no `asChild`. */}
      <form {...form.formProps} className="mt-4 flex flex-col gap-4">
        {/* Whatever could not be blamed on a field — a permission, a conflict. */}
        {form.formError ? <Alert tone="error">{errorMessage(form.formError)}</Alert> : null}
        {saved && !dirty ? <Alert tone="success">Saved. Applies immediately.</Alert> : null}

        {fields.map((field) => (
          <FieldControl
            key={field.key}
            field={field}
            value={draft[field.key]}
            error={readableError(field, draft[field.key], form.errorFor(field.key))}
            disabled={disabled || form.submitting}
            onChange={(next) => {
              setSaved(false);
              form.set(field.key, next);
            }}
          />
        ))}

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={disabled || form.submitting || !dirty}>
            {form.submitting ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}
