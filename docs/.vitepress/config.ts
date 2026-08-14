// Author: Brijesh Dave <https://github.com/brijeshdave>
// The public documentation site.
//
// It builds from `docs/` in place, which is the point: every page here is a plain
// markdown file that still reads correctly on GitHub, so there is no second copy
// to drift out of step with the first. Adding a page means adding a file and a
// sidebar entry below — a page with no entry is published and unreachable.
//
// Search is VitePress's local index: it ships inside the site, needs no account
// and no API key, and works with no network beyond the page itself. That matters
// for a self-hosted product whose readers may be behind a closed network.
import { defineConfig } from "vitepress";

/**
 * Where "Login" points.
 *
 * A documentation site cannot know which instance its reader runs, so this is a
 * build-time variable rather than a hardcoded host. Set `DOCS_APP_URL` in the
 * deploy environment; the fallback is the local development server, which is the
 * right answer for anyone reading these pages while running the stack.
 */
// `||`, not `??`: an unset CI variable arrives as an empty string rather than
// undefined, and `??` would happily accept it — leaving the Login link pointing
// at nothing.
const APP_URL = process.env.DOCS_APP_URL || "http://localhost:5173";

/**
 * The path the site is served from.
 *
 * GitHub Pages serves a project site under `/<repo>/`. Point a custom domain at
 * it and this becomes "/" — one line, and the only thing that changes.
 */
const BASE = process.env.DOCS_BASE || "/reportly/";

export default defineConfig({
  title: "Reportly",
  description:
    "Self-hosted technical journalling for departments — across multiple companies and locations, with group-based access control.",
  lang: "en-GB",
  base: BASE,
  // A missing target is a broken page for a reader, so a genuinely dead link
  // fails the build rather than shipping quietly. Localhost is exempted because
  // those URLs are instructions, not references: "open http://localhost:5173" is
  // the correct thing to print, and no build machine can resolve it.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ["meta", { name: "theme-color", content: "#6366f1" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Reportly" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Self-hosted technical journalling for departments.",
      },
    ],
  ],

  themeConfig: {
    siteTitle: "Reportly",

    nav: [
      { text: "Home", link: "/" },
      { text: "Introduction", link: "/overview" },
      { text: "Guide", link: "/user-guide" },
      { text: "Configuration", link: "/configuration" },
      { text: "Operations", link: "/operations" },
      { text: "Development", link: "/dev/faq" },
      { text: "FAQ", link: "/user/faq" },
      // Opens in a new tab on purpose: somebody reading the documentation is
      // usually mid-task, and replacing the page they are reading with a login
      // form loses their place.
      { text: "Login ↗", link: APP_URL, target: "_blank", rel: "noreferrer" },
    ],

    // Grouped by who is reading, which is how the index has always been written:
    // the person using Reportly, the person running it, and the person changing
    // it want almost disjoint sets of pages.
    sidebar: [
      {
        text: "Introduction",
        collapsed: false,
        items: [
          { text: "What Reportly is", link: "/overview" },
          { text: "Architecture", link: "/architecture" },
          { text: "Installation", link: "/installation" },
          { text: "Deploying on Ubuntu", link: "/ops/deployment-ubuntu" },
          { text: "Your first day", link: "/ops/first-day" },
        ],
      },
      {
        text: "Using Reportly",
        collapsed: false,
        items: [
          { text: "Worked examples", link: "/examples" },
          { text: "User guide", link: "/user-guide" },
          { text: "The Journal", link: "/reporting" },
          { text: "Insights", link: "/user/insights" },
          { text: "Notifications", link: "/user/notifications" },
          { text: "Shifts", link: "/user/shifts" },
          { text: "Routines", link: "/user/routines" },
          { text: "Cartridges", link: "/user/cartridges" },
          { text: "Import & export", link: "/user/import-export" },
          { text: "FAQ", link: "/user/faq" },
        ],
      },
      {
        text: "Running the server",
        collapsed: false,
        items: [
          { text: "Configuration", link: "/configuration" },
          { text: "Operations", link: "/operations" },
          { text: "Scaling", link: "/ops/scaling" },
          { text: "Queues", link: "/ops/queues" },
          { text: "Environment reference", link: "/reference/environment" },
        ],
      },
      {
        text: "Development",
        collapsed: false,
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "How the code is organised", link: "/dev/code-method" },
          { text: "Developer FAQ", link: "/dev/faq" },
          { text: "API", link: "/api" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/brijeshdave/reportly" }],

    search: {
      provider: "local",
      options: {
        detailedView: true,
      },
    },

    editLink: {
      pattern: "https://github.com/brijeshdave/reportly/edit/main/docs/:path",
      text: "Suggest a change to this page",
    },

    footer: {
      message: "Released under the AGPL-3.0 licence.",
      copyright: "© Brijesh Dave",
    },

    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },
  },
});
