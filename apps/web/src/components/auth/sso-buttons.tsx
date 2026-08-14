// Author: Brijesh Dave <https://github.com/brijeshdave>
// Sign-in buttons for whichever SSO providers an admin has enabled. Renders
// nothing at all when none are — no empty divider, no dead "or" separator.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import { ssoProvidersQuery } from "@/lib/queries.js";
import { signInWithSso } from "@/services/auth.js";

export function SsoButtons({ callbackURL = "/" }: { callbackURL?: string }) {
  // A failure here must not block password sign-in, so the error is swallowed
  // into an empty list and the form below still works.
  const { data: providers = [] } = useQuery(ssoProvidersQuery);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) return null;

  const start = async (id: string) => {
    setPending(id);
    setError(null);
    try {
      // On success the browser navigates away to the identity provider.
      await signInWithSso(id, callbackURL);
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="secondary"
            disabled={pending !== null}
            onClick={() => void start(provider.id)}
          >
            {pending === provider.id ? <Spinner /> : null}
            Continue with {provider.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
