// Author: Brijesh Dave <https://github.com/brijeshdave>
// A user, referred to by id. Where the name is already known (an audit row joins
// it in) pass it and this just renders it. Where it is not — a log line only
// carries a user id, and logs live in a different database that cannot be joined —
// it shows the short id with a look-up affordance, and fetches that one user on a
// click. Resolved users are cached by react-query, so the same id costs one fetch.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchUser } from "@/services/users.js";

/** Known name/email: render them, id underneath. */
function Known({ name, email }: { name: string; email?: string | null }) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-sm">{name}</span>
      {email ? <span className="text-xs text-muted-foreground">{email}</span> : null}
    </span>
  );
}

export function UserRef({
  userId,
  name,
  email,
}: {
  userId: string | null | undefined;
  /** When already resolved (e.g. joined server-side), skip the on-demand fetch. */
  name?: string | null;
  email?: string | null;
}) {
  const [lookup, setLookup] = useState(false);
  const query = useQuery({
    queryKey: ["user", userId],
    queryFn: () => fetchUser(userId as string),
    enabled: lookup && Boolean(userId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!userId) return <span className="text-muted-foreground">system</span>;
  if (name) return <Known name={name} email={email} />;
  if (query.data) return <Known name={query.data.name} email={query.data.email} />;

  return (
    <span className="inline-flex items-center gap-2">
      <code className="text-xs text-muted-foreground">{userId.slice(0, 8)}</code>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setLookup(true);
        }}
        disabled={query.isFetching}
        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
      >
        {query.isFetching ? "…" : query.isError ? "retry" : "look up"}
      </button>
    </span>
  );
}
