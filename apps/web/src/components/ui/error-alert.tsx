// Author: Brijesh Dave <https://github.com/brijeshdave>
// The standard way to show a failure. Beyond the message, it surfaces the request
// id the API returned, so a user who reports "it broke" can quote the one value
// that pulls up every log line for that exact request (Logs → filter by Request
// ID). Use this instead of a bare <Alert tone="error"> wherever an error object is
// in hand.
import { Alert } from "@/components/ui/form.js";
import { errorMessage, errorRequestId } from "@/lib/error-message.js";

export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  const requestId = errorRequestId(error);
  return (
    <Alert tone="error" className={className}>
      <p>{errorMessage(error)}</p>
      {requestId ? (
        <p className="mt-1 text-xs opacity-80">
          Reference ID: <code className="font-mono">{requestId}</code>
        </p>
      ) : null}
    </Alert>
  );
}
