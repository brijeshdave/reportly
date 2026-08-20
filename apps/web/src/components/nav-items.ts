// Author: Brijesh Dave <https://github.com/brijeshdave>
// The navigation model. Each item declares the permission that reveals it, so the
// sidebar, the route guards, and `<Can>` all agree on who sees what.
import {
  PERMISSIONS,
  type AuthContext,
  type Permission,
  can,
  ALL_REPORT_VIEW_PERMISSIONS,
} from "@reportly/shared";
import {
  ArrowLeftRight,
  ChartColumn,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Coins,
  DatabaseBackup,
  Layers,
  Factory,
  FileBarChart,
  FileText,
  ListChecks,
  HardDrive,
  KeyRound,
  LogIn,
  IdCard,
  Network,
  Printer,
  Repeat,
  ScrollText,
  Workflow,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Trophy,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Omit to show the item to every signed-in user. */
  permission?: Permission;
  /**
   * Show the item when the caller holds **any** of these. For a page whose tabs
   * carry separate permissions — JournalEntry setup, where severities, categories, tags
   * and device types are each grantable on their own — hiding it unless somebody
   * holds all of them would put a page they can legitimately use out of reach.
   */
  anyPermission?: Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    // The day-to-day work: what happened, what to do about it, and what it adds up to.
    label: "Work",
    items: [
      { label: "Journal", to: "/journal", icon: FileText, permission: PERMISSIONS.JOURNAL_READ },
      // Two halves: a manager's queue of entries awaiting their score, and
      // anybody's own work waiting on somebody else. The second is why this is
      // `journal:read` — the people who cannot appraise are exactly the ones who
      // could not otherwise tell whether their work had been looked at.
      {
        label: "Reviews",
        to: "/review",
        icon: ClipboardCheck,
        permission: PERMISSIONS.JOURNAL_READ,
      },
      // Next to the Journal on purpose: a task is the intent, an entry the record, and
      // completing one leads straight into the other.
      { label: "Tasks", to: "/tasks", icon: ListChecks, permission: PERMISSIONS.TASKS_READ },
      { label: "Downtime", to: "/downtime", icon: Clock, permission: PERMISSIONS.DOWNTIME_READ },
      // Manager-and-up: analytics:view is outside the seed's `:read` filter, so a
      // Member never sees this entry — matching what the API would answer.
      {
        label: "Analytics",
        to: "/analytics",
        icon: TrendingUp,
        permission: PERMISSIONS.ANALYTICS_VIEW,
      },
      // Its own permission, so an organisation can put the charts on a wall
      // screen without also granting the reliability figures beside them.
      {
        label: "Insights",
        to: "/insights",
        icon: ChartColumn,
        permission: PERMISSIONS.INSIGHTS_VIEW,
      },
    ],
  },
  {
    // Generated reports — the shaped, printable/exportable views over the journal.
    // One entry today (the reports library); as more named reports are saved they
    // appear on that page, and can be promoted here later.
    label: "Reports",
    items: [
      {
        label: "Reports",
        to: "/reports",
        icon: FileBarChart,
        // Each report carries its own key, so the section shows when the person
        // may read *any* of them — a rota lead with only the shift reports still
        // needs the door.
        anyPermission: [...ALL_REPORT_VIEW_PERMISSIONS],
      },
      // The celebratory face of the points ledger — the same data the reports
      // draw on, arranged as a podium. Its own permission, so it can be shown or
      // hidden independently of the Reports library.
      {
        label: "Leaderboard",
        to: "/reports/leaderboard",
        icon: Trophy,
        permission: PERMISSIONS.LEADERBOARD_VIEW,
      },
      // Everyone's own points ledger and their team's, plus a summary. `points:read`
      // is held by every role, so this is the one Reports-area entry a Member sees.
      {
        label: "My points",
        to: "/points",
        icon: Coins,
        permission: PERMISSIONS.POINTS_READ,
      },
    ],
  },
  {
    // Who works when. The shift catalogue and the per-department schedule calendar.
    label: "Scheduling",
    items: [
      {
        label: "Schedule",
        to: "/schedule",
        icon: CalendarDays,
        permission: PERMISSIONS.SHIFTS_READ,
      },
      {
        label: "Shift change",
        to: "/schedule/changes",
        icon: ArrowLeftRight,
        permission: PERMISSIONS.SHIFTS_READ,
      },
      { label: "Shifts", to: "/shifts", icon: Clock, permission: PERMISSIONS.SHIFTS_MANAGE },
    ],
  },
  {
    // Recurring team duties, and the record of who kept up.
    label: "Routines",
    items: [
      {
        label: "My routines",
        to: "/routines",
        icon: ListChecks,
        permission: PERMISSIONS.ROUTINES_READ,
      },
      {
        label: "Team routines",
        to: "/routines/manage",
        icon: Repeat,
        permission: PERMISSIONS.ROUTINES_MANAGE,
      },
    ],
  },
  {
    // The physical things reports are about.
    label: "Assets",
    items: [
      { label: "Assets", to: "/assets", icon: Factory, permission: PERMISSIONS.ASSETS_READ },
      { label: "Devices", to: "/devices", icon: HardDrive, permission: PERMISSIONS.DEVICES_READ },
    ],
  },
  {
    // An optional module. Both entries disappear entirely for a company that has
    // not switched it on — see `visibleNavGroups`, and the API's 404.
    label: "Cartridges",
    items: [
      { label: "Cartridges", to: "/cartridges", icon: Printer, permission: PERMISSIONS.PARTS_READ },
      {
        label: "Cartridge setup",
        to: "/cartridges/setup",
        icon: SlidersHorizontal,
        // Read, not configure: somebody who may see the catalogues but not edit
        // them still has a reason to look at what a refill is worth. The buttons
        // inside are what `parts:configure` gates.
        permission: PERMISSIONS.PARTS_READ,
      },
    ],
  },
  {
    // The shape of the organisation the work happens in.
    label: "Organisation",
    items: [
      {
        label: "Companies",
        to: "/companies",
        icon: Building2,
        permission: PERMISSIONS.COMPANIES_READ,
      },
      // Locations have no page of their own: they exist only inside a company,
      // and the API scopes them that way too.
      {
        label: "Departments",
        to: "/departments",
        icon: Network,
        permission: PERMISSIONS.DEPARTMENTS_READ,
      },
      {
        label: "Organisation",
        to: "/organization",
        icon: Workflow,
        permission: PERMISSIONS.DEPARTMENTS_READ,
      },
    ],
  },
  {
    // Who the people are and what they may do.
    label: "People & access",
    items: [
      { label: "Users", to: "/users", icon: Users, permission: PERMISSIONS.USERS_READ },
      {
        label: "Designations",
        to: "/designations",
        icon: IdCard,
        permission: PERMISSIONS.DESIGNATIONS_READ,
      },
      { label: "Groups", to: "/groups", icon: UsersRound, permission: PERMISSIONS.GROUPS_READ },
      { label: "Roles", to: "/roles", icon: KeyRound, permission: PERMISSIONS.ROLES_READ },
    ],
  },
  {
    // Configuration and the operator's own tooling.
    label: "System",
    items: [
      {
        label: "JournalEntry setup",
        to: "/journal-config",
        icon: SlidersHorizontal,
        // Any one of the four catalogues is reason enough to open the page; the
        // tabs a person cannot edit still show their contents read-only.
        anyPermission: [
          PERMISSIONS.JOURNAL_CONFIG_MANAGE,
          PERMISSIONS.CATEGORIES_MANAGE,
          PERMISSIONS.TAGS_MANAGE,
          PERMISSIONS.DEVICE_TYPES_MANAGE,
        ],
      },
      { label: "Settings", to: "/settings", icon: Settings, permission: PERMISSIONS.SETTINGS_READ },
      {
        label: "Single sign-on",
        to: "/settings/sso",
        icon: LogIn,
        permission: PERMISSIONS.SETTINGS_READ,
      },
      { label: "Logs", to: "/logs", icon: ScrollText, permission: PERMISSIONS.LOGS_VIEW },
      { label: "Audit", to: "/audit", icon: ShieldCheck, permission: PERMISSIONS.AUDIT_VIEW },
      {
        label: "Backups",
        to: "/backups",
        icon: DatabaseBackup,
        permission: PERMISSIONS.BACKUPS_MANAGE,
      },
      // Hidden unless the server has QUEUE_ADMIN set as well — see visibleNavGroups.
      { label: "Queues", to: "/queues", icon: Layers, permission: PERMISSIONS.QUEUES_VIEW },
    ],
  },
];

/**
 * The groups this caller may see, with empty groups dropped. Items without a
 * permission are visible to every signed-in user.
 */
export function visibleNavGroups(
  ctx: Pick<AuthContext, "permissions" | "isSuperadmin">,
  /**
   * Entries the server has switched off entirely, by `to`.
   *
   * A permission is about the person; this is about the installation, or about
   * the company. Queues was the first entry with both: holding `queues:view` on a
   * server running with QUEUE_ADMIN unset means the API never mounted the routes,
   * so the page would be a working link to a screen whose every request 404s. The
   * cartridges entries are the same shape one level down — the company, not the
   * server, decides whether that work happens here at all.
   */
  disabled: readonly string[] = [],
): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (disabled.includes(item.to)) return false;
      if (item.anyPermission) return item.anyPermission.some((p) => can(ctx, p));
      return !item.permission || can(ctx, item.permission);
    }),
  })).filter((group) => group.items.length > 0);
}

/**
 * The nav item that should light up for a path, as its `to` — the most specific
 * match, so `/settings/sso` activates "Single sign-on" and not its parent
 * "Settings", while a detail route like `/companies/123` still activates
 * "Companies". Returns null when nothing matches.
 */
export function activeNavTo(pathname: string, tos: string[]): string | null {
  const matches = tos.filter((to) => pathname === to || pathname.startsWith(`${to}/`));
  if (matches.length === 0) return null;
  // Longest `to` is the most specific.
  return matches.reduce((best, to) => (to.length > best.length ? to : best));
}

/** Greeting that matches the user's local time of day. */
export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
