// Author: Brijesh Dave <https://github.com/brijeshdave>
// Where the documentation lives.
//
// Configurable rather than hardcoded, because a self-hosted installation may not
// be able to reach the public site at all: a plant on a closed network needs to
// point at its own copy, and sending those users to github.io would be sending
// them nowhere. Set `VITE_DOCS_URL` at build time.
//
// Vite substitutes `import.meta.env` at build time, so this is a constant in the
// bundle rather than a lookup — which is also why changing it means rebuilding
// the web image, not restarting it.

/** The public site, used when nothing else is configured. */
const DEFAULT_DOCS_URL = "https://brijeshdave.github.io/reportly/";

/**
 * The documentation root.
 *
 * `||` rather than `??`: an unset variable in a Docker build arrives as an empty
 * string rather than undefined, and `??` would accept it and leave every
 * documentation link pointing at nothing.
 */
export const DOCS_URL: string = import.meta.env.VITE_DOCS_URL || DEFAULT_DOCS_URL;
