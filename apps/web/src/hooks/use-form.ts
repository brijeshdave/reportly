// Author: Brijesh Dave <https://github.com/brijeshdave>
// Form state that validates against the API's own schema, and shows what it finds
// under the field it is about.
//
// The point is that there is no second set of rules. A screen validates with the very
// `@reportly/shared` schema the route parses with, so the browser cannot drift into
// accepting something the server refuses — which is the failure this replaced: every
// refusal arrived as one sentence above the form, from a server that knew exactly
// which input it meant.
//
// The server stays the decision. Checking first only means a person is told at the
// field, before a round trip; a refusal that only the server can make (a name already
// taken, a date past the grace period) comes back carrying its own field map and is
// merged into the same place. See `fieldErrorsFrom` in @reportly/shared.
import { fieldErrorsFrom, type FieldErrors } from "@reportly/shared";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";

import { ApiError } from "@/services/http.js";

/** What this hook needs of a schema — zod's shape, without naming zod's classes. */
export interface ParsesInto<T> {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}

export interface UseFormOptions<Values extends object, Payload> {
  /** The API's schema for this request. Not a copy of it — the same object. */
  schema: ParsesInto<Payload>;
  initial: Values;
  /**
   * The request body this form's state becomes. Omit where the state already is the
   * body. Keys that survive this mapping are the keys errors come back under, so a
   * field whose name changes here needs `fieldName` to say so.
   */
  toPayload?: (values: Values) => unknown;
  /**
   * Where a payload key differs from the input's name. Rare, and worth avoiding: the
   * two matching is what lets a server refusal find its field with no mapping at all.
   */
  fieldName?: (payloadKey: string) => string;
  submit: (payload: Payload) => Promise<unknown>;
  onSuccess?: (result: unknown) => void | Promise<void>;
}

export interface FormHandle<Values extends object> {
  values: Values;
  set: <K extends keyof Values>(key: K, value: Values[K]) => void;
  /** Replace the whole state — loading a different record into the same form. */
  reset: (next: Values) => void;
  errors: FieldErrors;
  errorFor: (key: string) => string | undefined;
  /** Whatever could not be blamed on a field: a 403, a conflict, a network failure. */
  formError: unknown | null;
  submitting: boolean;
  handleSubmit: (event?: FormEvent) => Promise<void>;
  /** Everything a text input, textarea or select needs to take part. */
  register: <K extends keyof Values & string>(
    key: K,
  ) => {
    name: K;
    value: Values[K];
    onChange: (event: { target: { value: string } }) => void;
    onBlur: () => void;
  };
  /** Put on the <form> so a failed submit can move focus to the first bad field. */
  formRef: React.RefObject<HTMLFormElement | null>;
}

export function useForm<Values extends object, Payload>({
  schema,
  initial,
  toPayload,
  fieldName,
  submit,
  onSuccess,
}: UseFormOptions<Values, Payload>): FormHandle<Values> {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<unknown | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const rename = useCallback((key: string) => (fieldName ? fieldName(key) : key), [fieldName]);

  const validate = useCallback(
    (state: Values) => {
      const payload = toPayload ? toPayload(state) : state;
      const result = schema.safeParse(payload);
      if (result.success) return { fields: {} as FieldErrors, data: result.data };
      const raw = fieldErrorsFrom(result.error.issues);
      const fields: FieldErrors = {};
      for (const [key, message] of Object.entries(raw)) fields[rename(key)] = message;
      return { fields, data: undefined };
    },
    [rename, schema, toPayload],
  );

  const set = useCallback(<K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // The message goes the moment the person starts fixing it. Re-validating on every
    // keystroke instead would turn a half-typed email into a running commentary on how
    // wrong it is so far, which is why this clears rather than re-checks.
    setErrors((prev) => {
      if (!(String(key) in prev)) return prev;
      const next = { ...prev };
      delete next[String(key)];
      return next;
    });
  }, []);

  /** Check one field, on leaving it — late enough that a half-typed value is not judged. */
  const touch = useCallback(
    (key: string) => {
      const { fields } = validate(values);
      setErrors((prev) => {
        const message = fields[key];
        if (message === undefined) return prev;
        return { ...prev, [key]: message };
      });
    },
    [validate, values],
  );

  const nodeFor = useCallback(
    (key: string) =>
      formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(key)}"]`) ?? null,
    [],
  );

  /**
   * Move to the first bad field, and refuse to fail silently.
   *
   * A message can only be read if something draws it. A field the form validates but
   * does not `register` has no input to carry the message and none to move focus to,
   * so the submit stopped, said nothing, and looked like a dead button — reported
   * exactly that way about the journal editor's work fields, which were left unwired
   * when the rest of the form was converted.
   *
   * So anything with nowhere to go is gathered into the form-level alert instead. It
   * is not as good as a message under the input, and it is not meant to be: it is the
   * floor, and it holds while the remaining forms are still being converted.
   */
  const focusFirst = useCallback(
    (fields: FieldErrors) => {
      const keys = Object.keys(fields);
      if (keys.length === 0) return;

      const homeless = keys.filter((key) => !nodeFor(key));
      if (homeless.length > 0) {
        setFormError(new Error(homeless.map((key) => fields[key]).join(" ")));
      }

      const first = keys.find((key) => nodeFor(key));
      if (!first) return;
      const node = nodeFor(first);
      // Scrolled as well as focused: on a long form the bad field is often above or
      // below the fold, and a focus nobody can see reads as a submit that did nothing.
      // Called defensively — `scrollIntoView` is absent in jsdom and on old engines,
      // and a throw here would take the whole submit with it to move the page a little.
      node?.focus();
      node?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    },
    [nodeFor],
  );

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      setFormError(null);

      const { fields, data } = validate(values);
      if (data === undefined) {
        setErrors(fields);
        // After `setFormError(null)` above, so the net it may set survives this pass.
        focusFirst(fields);
        return;
      }
      setErrors({});

      setSubmitting(true);
      try {
        const result = await submit(data);
        await onSuccess?.(result);
      } catch (error) {
        // The server is the final word, and it says where it hurts. Anything it could
        // not attribute — a permission, a conflict — stays a sentence above the form,
        // because there is no input for a person to correct.
        if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
          const mapped: FieldErrors = {};
          for (const [key, message] of Object.entries(error.fields)) mapped[rename(key)] = message;
          setErrors(mapped);
          focusFirst(mapped);
          // Kept as well, so a refusal naming a field the form does not draw is still
          // readable rather than silently swallowed.
          setFormError(error);
          return;
        }
        setFormError(error);
      } finally {
        setSubmitting(false);
      }
    },
    [focusFirst, onSuccess, rename, submit, validate, values],
  );

  const register = useCallback(
    <K extends keyof Values & string>(key: K) => ({
      name: key,
      value: values[key],
      onChange: (event: { target: { value: string } }) => set(key, event.target.value as Values[K]),
      onBlur: () => touch(key),
    }),
    [set, touch, values],
  );

  const errorFor = useCallback((key: string) => errors[key], [errors]);

  const reset = useCallback((next: Values) => {
    setValues(next);
    setErrors({});
    setFormError(null);
  }, []);

  return useMemo(
    () => ({
      values,
      set,
      reset,
      errors,
      errorFor,
      formError,
      submitting,
      handleSubmit,
      register,
      formRef,
    }),
    [errorFor, errors, formError, handleSubmit, register, reset, set, submitting, values],
  );
}
