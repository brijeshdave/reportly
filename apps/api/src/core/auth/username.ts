// Author: Brijesh Dave <https://github.com/brijeshdave>
// Guarantees every account has a login name, whatever created it.
//
// Reportly asks for one on the forms it owns, but better-auth creates users on
// paths that never see them: an OIDC sign-in, and a public sign-up. A login name
// is required and unique, so those paths would otherwise fail on the constraint —
// or, worse, mean the rule quietly held only for accounts made through the UI.
// The `user.create` hook in auth.ts fills the gap with this.
import { eq } from "drizzle-orm";
import { suggestUsername } from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";

async function taken(username: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return row !== undefined;
}

/**
 * A login name derived from the address, with a numeric suffix if that is already
 * someone's — "ada", then "ada2". Bounded: two people can share a local part
 * across domains, but not a hundred, and an unbounded loop here would be a way to
 * hang a sign-up.
 */
export async function uniqueUsername(email: string): Promise<string> {
  const base = suggestUsername(email);
  if (!(await taken(base))) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base.slice(0, 29)}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }

  // Give up on a pretty name rather than on the sign-in: a random tail is still a
  // usable login name, and the person can change it.
  return `${base.slice(0, 24)}${Date.now().toString(36).slice(-6)}`;
}
