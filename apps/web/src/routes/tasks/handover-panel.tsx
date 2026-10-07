// Author: Brijesh Dave <https://github.com/brijeshdave>
// Handing a task on when a shift ends before the work does.
//
// Asked for from live use: "there may be a case when task was long and user's shoft
// was finished and he handedover it to someone else. In that case he need to tell
// his manager to handover the task and points needs to be splited acordingly."
//
// So the manager acts, not the worker — the panel is only drawn for somebody who
// may assign the task. The outgoing person is released, not removed: they stay on
// the task, they are on the entry when the work is written up, and the author
// divides the points between everybody who did it.
import {
  formatDate,
  handoverTaskSchema,
  type HandoverTask,
  type Task,
  type TaskAssignee,
} from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { Field, Input, Select, Spinner } from "@/components/ui/form.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline } from "@/services/departments.js";
import { handoverTask } from "@/services/tasks.js";

export function HandoverPanel({ task, onDone }: { task: Task; onDone: () => Promise<unknown> }) {
  const { data: session } = useQuery(sessionQuery);
  const me = session?.user;
  const onIt: TaskAssignee[] = task.assignees.filter((person) => !person.released);

  // The same reporting line the server checks the handover against, so the picker
  // cannot offer somebody the API will refuse.
  const downline = useQuery({
    queryKey: ["downline", me?.id],
    queryFn: () => fetchDownline(me!.id),
    enabled: Boolean(me?.id),
  });

  // The route's own schema. "Who picks it up" is the field people leave empty, and
  // the refusal for it now sits under that picker rather than above the panel.
  const form = useForm<{ from: string; to: string; reason: string }, HandoverTask>({
    schema: handoverTaskSchema,
    initial: { from: onIt[0]?.id ?? "", to: "", reason: "" },
    toPayload: (v) => ({
      fromUserId: v.from,
      toUserId: v.to,
      ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
    }),
    // The schema's keys are not the form's: `fromUserId` has no input, `from` does.
    fieldName: (key) =>
      key === "fromUserId" ? "from" : key === "toUserId" ? "to" : key === "reason" ? "reason" : key,
    submit: (input) => handoverTask(task.id, input),
    onSuccess: async () => {
      form.reset({ from: onIt[0]?.id ?? "", to: "", reason: "" });
      await onDone();
    },
  });
  const { to } = form.values;

  // Nobody already on the task: handing it to somebody who has it is not a handover.
  const held = new Set(onIt.map((person) => person.id));
  const options = (downline.data ?? [])
    .filter((person) => !held.has(person.userId))
    .map((person) => ({
      value: person.userId,
      label: person.name,
      hint: person.departmentName || undefined,
    }));

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Hand over</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        For work that outlasts a shift. Whoever hands it on stays on the task, so the points can be
        divided between both of them when it is written up.
      </p>
      {/* Whatever could not be blamed on a field — a permission, a conflict. */}
      {form.formError ? <ErrorAlert error={form.formError} /> : null}

      {onIt.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is on this task yet — assign it before handing it over.
        </p>
      ) : (
        <form {...form.formProps} className="contents">
          <Field label="From" required error={form.errorFor("from")}>
            {(props) => (
              <Select {...props} {...form.register("from")}>
                {onIt.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="To" required error={form.errorFor("to")}>
            {(props) => (
              <SearchableSelect
                {...props}
                name="to"
                value={to}
                onChange={(next) => form.set("to", next)}
                options={options}
                placeholder="Who picks it up"
              />
            )}
          </Field>

          <Field
            label="Why"
            error={form.errorFor("reason")}
            hint="Optional — what was left to do, and why it moved."
          >
            {(props) => (
              <Input
                {...props}
                {...form.register("reason")}
                placeholder="Shift ended, panel still open"
              />
            )}
          </Field>

          <Button size="sm" type="submit" disabled={form.submitting}>
            {form.submitting ? <Spinner /> : null}
            Hand over
          </Button>
        </form>
      )}

      {task.handovers.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t pt-3 text-sm">
          {task.handovers.map((h) => (
            <li key={h.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {h.fromUserName ?? "Nobody"} → {h.toUserName ?? "nobody"}
              </span>{" "}
              · {formatDate(h.handedAt)}
              {h.byUserName ? ` · by ${h.byUserName}` : ""}
              {h.reason ? <p className="text-xs">{h.reason}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
