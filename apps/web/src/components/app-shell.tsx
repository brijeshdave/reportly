// Author: Brijesh Dave <https://github.com/brijeshdave>
// Authenticated layout: a white grouped sidebar with a pill active state, a topbar
// with greeting / company switcher / user menu, and a full-width main area. Sidebar
// and main scroll independently; on phones the sidebar becomes a drawer.
import { THEME_MODES, type ThemeMode } from "@reportly/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Sun,
  User,
  X,
} from "lucide-react";
import { Suspense, useState, useEffect } from "react";

import { Avatar } from "@/components/avatar.js";
import { ErrorBoundary } from "@/components/error-boundary.js";
import { NotificationBell } from "@/components/notification-bell.js";
import { useTheme } from "@/components/theme-provider.js";
import {
  activeNavTo,
  greetingFor,
  visibleNavGroups,
  type NavItem,
} from "@/components/nav-items.js";
import { Spinner } from "@/components/ui/form.js";
import { DOCS_URL } from "@/lib/docs-url.js";
import { Badge, Button } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { sessionQuery } from "@/lib/queries.js";
import { setActiveCompanyId } from "@/services/http.js";
import { signOut } from "@/services/session.js";

function BrandMark() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2 py-1">
      {/* The mark itself rather than an "R": the app had a logo all along and wore
          a letter instead. Empty alt — the wordmark beside it already names it. */}
      <img src="/icon-app.svg" alt="" width={36} height={36} className="h-9 w-9 rounded-xl" />
      <span className="text-base font-semibold tracking-tight">Reportly</span>
    </Link>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      // Exact, so the router does not also mark a parent (/settings) active on a
      // child route (/settings/sso); which item lights up is decided by `active`
      // (activeNavTo), which still keeps a parent active on its own detail routes.
      activeOptions={{ exact: true }}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Compact on purpose: this sidebar carries thirty-odd entries across nine
        // groups, and at the old rhythm the lower half needed scrolling on a
        // laptop. Tighter padding and a smaller radius buy roughly a third of the
        // height back without making the targets too small to hit.
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "brand-gradient font-medium text-primary-foreground shadow-sm"
          : "font-normal text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Which groups the reader has open, remembered across navigations.
 *
 * In localStorage rather than component state: a fold that sprang open on every
 * page change would be pointless, since navigating is exactly when you would
 * notice the sidebar.
 *
 * Stored as the OPEN set, not the closed one, because the default is now shut.
 * Thirty-odd entries across nine groups do not fit a laptop screen, so arriving
 * with everything open means scrolling to find anything; arriving with one group
 * open means reading nine headings. The key is deliberately not the old
 * `…collapsed` one — the same array read under the opposite meaning would turn
 * every existing reader's sidebar inside out.
 *
 * `null` means never touched, so the caller can choose the opening group rather
 * than have an empty set mean "all shut".
 */
const EXPANDED_KEY = "reportly.nav.expanded";

function readExpanded(): Set<string> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    // A corrupt entry is not worth a broken sidebar.
    return null;
  }
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const groups = visibleNavGroups(
    { permissions: session.permissions, isSuperadmin: session.isSuperadmin },
    // The server decides whether Queues exists at all, and the company decides
    // whether it refills cartridges; the permission decides who sees either. All
    // of them have to agree, or the sidebar offers a link that leads nowhere.
    [
      ...(session.queueAdmin === "off" ? ["/queues"] : []),
      ...(session.modules.parts ? [] : ["/cartridges", "/cartridges/setup"]),
    ],
  );
  // Resolve the single active item across all groups, so a child route
  // (/settings/sso) never also lights up its parent (/settings).
  const allTos = groups.flatMap((group) => group.items.map((item) => item.to));
  const activeTo = activeNavTo(pathname, allTos);

  // Fresh reader: open the first group they can see. That is Work for almost
  // everyone, and for someone whose permissions hide Work it is whatever their
  // top group is — better than a sidebar of nine headings and nothing else.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => readExpanded() ?? new Set(groups.slice(0, 1).map((group) => group.label)),
  );

  const toggle = (label: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode, quota, whatever — the sidebar still works this session.
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto border-r border-border bg-card px-2.5 py-3">
      <BrandMark />
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
        {groups.map((group) => {
          const holdsActive = group.items.some((item) => item.to === activeTo);
          // A group holding the current page is always open. Collapsing the one
          // you are looking at would hide the highlighted entry and leave no clue
          // where you are.
          const open = holdsActive || expanded.has(group.label);
          const panelId = `nav-${group.label.replace(/\W+/g, "-").toLowerCase()}`;
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggle(group.label)}
                aria-expanded={open}
                aria-controls={panelId}
                className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
                  aria-hidden
                />
                <span className="truncate">{group.label}</span>
              </button>
              {open ? (
                // Indented behind a rail that runs through the chevron. Without
                // it the items sat on the group's own left edge, so a heading
                // read as a peer of the links under it rather than their parent —
                // and with several groups open there was nothing to show where
                // one ended and the next began.
                <div
                  id={panelId}
                  className="ml-4 flex flex-col gap-0.5 border-l border-border pb-1 pl-1"
                >
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      item={item}
                      active={item.to === activeTo}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

/** The account menu in the topbar: who you are, a link to your profile, and the way
 *  out. Lives here rather than in the sidebar so it is in reach on every screen and
 *  the sign-out is one deliberate step behind a menu, not a button you brush past. */
const MODE_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function ThemeToggle() {
  const { theme, setMode } = useTheme();
  return (
    <div className="border-t border-border px-3 py-2">
      <p className="pb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
      <div className="flex gap-1">
        {THEME_MODES.map((mode) => {
          const Icon = MODE_ICON[mode];
          const active = theme.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              aria-pressed={active}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors",
                active
                  ? "brand-gradient border-transparent text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {mode}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UserMenu() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const signOutNow = async () => {
    await signOut();
    queryClient.clear();
    window.location.assign("/login");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        // Named explicitly: without this the button's accessible name is the
        // avatar plus whatever the person is called, so a screen reader announces
        // someone's name where a control should be, and anything addressing it by
        // role has to know who is signed in.
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-border px-2 py-1.5 text-sm hover:bg-muted"
      >
        <Avatar
          userId={session.user.id}
          name={session.user.name}
          version={session.user.avatarVersion}
          size="sm"
        />
        <span className="hidden max-w-[10rem] truncate font-medium sm:block">
          {session.user.name.split(" ")[0]}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>

      {open ? (
        <>
          {/* A full-screen catcher so a click anywhere else closes the menu. */}
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-card p-1 shadow-lg"
          >
            <div className="flex items-center gap-3 border-b border-border px-3 py-2">
              <Avatar
                userId={session.user.id}
                name={session.user.name}
                version={session.user.avatarVersion}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                {session.isSuperadmin ? (
                  <Badge tone="brand" className="mt-1">
                    Superadmin
                  </Badge>
                ) : null}
              </div>
            </div>
            <Link
              to="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
            >
              <User className="h-4 w-4" aria-hidden />
              Profile
            </Link>

            {/* The documentation is a different place, not a different page, so it
                opens in a new tab — losing what you were doing to read how to do
                it is a poor trade. Where it points is configurable, because a
                closed network hosts its own copy. */}
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              Documentation
              <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </a>

            {/* Theme lives here, not just in Settings: switching light/dark is a
                per-moment thing (a bright room, a night shift), so it belongs one
                click from anywhere. It writes through to your saved preference. */}
            <ThemeToggle />

            <button
              type="button"
              role="menuitem"
              onClick={signOutNow}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function CompanySwitcher() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();

  // "All companies" resolves to *no* company, and a person's permissions are
  // resolved per company — so for anybody but a superadmin that state grants
  // nothing: an empty sidebar and a 403 from every call, which reads exactly like
  // their access has been taken away. It is only meaningful for a superadmin, who
  // holds everything regardless, so nobody else is offered it and anybody who
  // lands there is moved to their own company.
  const needsCompany = !session.isSuperadmin && !session.companyId && session.companies.length > 0;
  useEffect(() => {
    if (!needsCompany) return;
    setActiveCompanyId(session.companies[0]!.id);
    void queryClient.invalidateQueries();
  }, [needsCompany, session.companies, queryClient]);

  if (session.companies.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Active company</span>
      <select
        value={session.companyId ?? ""}
        onChange={(event) => {
          setActiveCompanyId(event.target.value || null);
          // Everything is company-scoped; refetch against the new company.
          void queryClient.invalidateQueries();
        }}
        className="h-9 rounded-xl border border-border bg-card px-3 text-sm"
      >
        {/* Superadmins only — see above. */}
        {session.isSuperadmin ? <option value="">All companies</option> : null}
        {session.companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { data: session } = useSuspenseQuery(sessionQuery);

  return (
    <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        onClick={onOpenSidebar}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {greetingFor()}, {session.user.name.split(" ")[0]}
        </p>
      </div>

      <NotificationBell />
      <CompanySwitcher />
      <UserMenu />
    </header>
  );
}

/** Held while a route's own chunk is on the wire. Deliberately plain: it is on
 *  screen for a few hundred milliseconds and only on the first visit to a page. */
function PageSpinner() {
  return (
    <div className="flex justify-center p-10" role="status" aria-label="Loading">
      <Spinner />
    </div>
  );
}

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    // No background fill on this root: the body carries the theme's gradient wash,
    // and the sidebar and topbar are opaque cards on top of it, so it shows through
    // behind the main content.
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-72" role="dialog" aria-label="Navigation">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              className="absolute right-2 top-2 z-10"
              onClick={() => setDrawerOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <ErrorBoundary boundary="app-shell">
            {/* Every page is fetched when its route is, so there is a moment before
                one arrives. Inside the error boundary, not outside: a chunk that
                fails to load is an error to be shown, not a spinner for ever. */}
            <Suspense fallback={<PageSpinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
