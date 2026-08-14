// Author: Brijesh Dave <https://github.com/brijeshdave>
// A password input that shows the live requirement checklist. The rules come from
// the server, so the list always matches what the API will actually enforce.
import { passwordViolations, type PasswordRules, type PasswordViolation } from "@reportly/shared";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { useState } from "react";

import { Field, Input } from "@/components/ui/form.js";
import { cn } from "@/lib/cn.js";

interface ChecklistItem {
  rule: PasswordViolation["rule"];
  label: string;
  met: boolean;
}

/** Each rule the policy enforces, paired with whether `value` satisfies it. */
function checklist(rules: PasswordRules, value: string): ChecklistItem[] {
  const failed = new Set(passwordViolations(rules, value).map((violation) => violation.rule));
  const items: Omit<ChecklistItem, "met">[] = [
    { rule: "minLength", label: `At least ${rules.minLength} characters` },
  ];
  if (rules.requireUppercase)
    items.push({ rule: "requireUppercase", label: "An uppercase letter" });
  if (rules.requireNumber) items.push({ rule: "requireNumber", label: "A number" });
  if (rules.requireSymbol) items.push({ rule: "requireSymbol", label: "A symbol" });
  return items.map((item) => ({ ...item, met: !failed.has(item.rule) }));
}

export function PasswordField({
  label = "Password",
  value,
  onChange,
  rules,
  error,
  autoComplete = "new-password",
  disabled,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** Omit to hide the checklist (e.g. on sign-in, where the rules don't apply). */
  rules?: PasswordRules;
  error?: string | null;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  // An empty field satisfies nothing, which reads as neutral guidance.
  const items = rules ? checklist(rules, value) : null;

  return (
    <Field
      label={label}
      error={error}
      hint={
        items ? (
          <ul className="mt-0.5 space-y-1">
            {items.map(({ rule, label: text, met }) => {
              const Icon = met ? Check : X;
              return (
                <li key={rule} className="flex items-center gap-1.5">
                  <Icon
                    className={cn("h-3 w-3", met ? "text-success" : "text-muted-foreground/60")}
                    aria-hidden
                  />
                  <span className={cn(met && "text-success")}>{text}</span>
                </li>
              );
            })}
          </ul>
        ) : undefined
      }
    >
      {(fieldProps) => (
        <div className="relative">
          <Input
            {...fieldProps}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete={autoComplete}
            disabled={disabled}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={visible ? "Hide password" : "Show password"}
          >
            {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
      )}
    </Field>
  );
}
