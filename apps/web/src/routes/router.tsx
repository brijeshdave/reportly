// Author: Brijesh Dave <https://github.com/brijeshdave>
// Route tree and guards. Guards mirror the API: `requireSession` blocks anonymous
// access, `requirePermission` blocks actions the server would reject anyway. The
// UI hides what it can; the API is still the enforcement point.
import { lazy } from "react";

import { PERMISSIONS, type Permission, can, ALL_REPORT_VIEW_PERMISSIONS } from "@reportly/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  Outlet,
} from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell.js";
import { LoginPage } from "@/routes/auth/login.js";
import { RegisterPage } from "@/routes/auth/register.js";
import { AcceptInvitePage, ResetPasswordPage } from "@/routes/auth/set-password.js";

/**
 * Every page, fetched when its route is.
 *
 * `React.lazy` rather than the router's `lazyRouteComponent` because these are
 * rendered with props — a mode, an id out of the path — and that helper hands
 * back a component the router calls with none. The Suspense boundary they need
 * lives around the shell's outlet.
 *
 * The sign-in pages stay eager: they are the first thing a signed-out visitor
 * sees, and a round trip to fetch the form is a round trip before anyone can do
 * anything at all.
 */
const AssetsPage = lazy(() =>
  import("@/routes/assets/assets-page.js").then((m) => ({ default: m.AssetsPage })),
);
const CompanyDetailPage = lazy(() =>
  import("@/routes/companies/company-detail.js").then((m) => ({ default: m.CompanyDetailPage })),
);
const DepartmentDetailPage = lazy(() =>
  import("@/routes/departments/department-detail.js").then((m) => ({
    default: m.DepartmentDetailPage,
  })),
);
const DepartmentEditorPage = lazy(() =>
  import("@/routes/departments/department-editor-page.js").then((m) => ({
    default: m.DepartmentEditorPage,
  })),
);
const DesignationEditorPage = lazy(() =>
  import("@/routes/designations/designation-editor-page.js").then((m) => ({
    default: m.DesignationEditorPage,
  })),
);
const CartridgeSetupPage = lazy(() =>
  import("@/routes/parts/cartridge-setup.js").then((m) => ({ default: m.CartridgeSetupPage })),
);
const PartDetailPage = lazy(() =>
  import("@/routes/parts/part-detail.js").then((m) => ({ default: m.PartDetailPage })),
);
const DeviceEditorPage = lazy(() =>
  import("@/routes/devices/device-editor-page.js").then((m) => ({ default: m.DeviceEditorPage })),
);
const DowntimePage = lazy(() =>
  import("@/routes/downtime/downtime-page.js").then((m) => ({ default: m.DowntimePage })),
);
const GroupDetailPage = lazy(() =>
  import("@/routes/groups/group-detail.js").then((m) => ({ default: m.GroupDetailPage })),
);
const JournalEntryDetailPage = lazy(() =>
  import("@/routes/journal/report-detail.js").then((m) => ({ default: m.JournalEntryDetailPage })),
);
const JournalEntryEditorPage = lazy(() =>
  import("@/routes/journal/report-editor-page.js").then((m) => ({
    default: m.JournalEntryEditorPage,
  })),
);
const JournalListPage = lazy(() =>
  import("@/routes/journal/journal-list.js").then((m) => ({ default: m.JournalListPage })),
);
const LogsPage = lazy(() =>
  import("@/routes/logs/logs-page.js").then((m) => ({ default: m.LogsPage })),
);
const ProfilePage = lazy(() =>
  import("@/routes/profile/profile-page.js").then((m) => ({ default: m.ProfilePage })),
);
const QueueDetailPage = lazy(() =>
  import("@/routes/queues/queue-detail-page.js").then((m) => ({ default: m.QueueDetailPage })),
);
const ReportConfigPage = lazy(() =>
  import("@/routes/journal-config/journal-config-page.js").then((m) => ({
    default: m.ReportConfigPage,
  })),
);
const ReportWorkspace = lazy(() =>
  import("@/routes/reports/report-workspace.js").then((m) => ({ default: m.ReportWorkspace })),
);
const RoleDetailPage = lazy(() =>
  import("@/routes/roles/role-detail-page.js").then((m) => ({ default: m.RoleDetailPage })),
);
const RoleEditorPage = lazy(() =>
  import("@/routes/roles/role-editor-page.js").then((m) => ({ default: m.RoleEditorPage })),
);
const RoutineDetailPage = lazy(() =>
  import("@/routes/routines/routine-detail.js").then((m) => ({ default: m.RoutineDetailPage })),
);
const RoutineEditorPage = lazy(() =>
  import("@/routes/routines/routine-editor.js").then((m) => ({ default: m.RoutineEditorPage })),
);
const SettingsPage = lazy(() =>
  import("@/routes/settings/settings-page.js").then((m) => ({ default: m.SettingsPage })),
);
const ShiftEditorPage = lazy(() =>
  import("@/routes/shifts/shift-editor-page.js").then((m) => ({ default: m.ShiftEditorPage })),
);
const TaskDetailPage = lazy(() =>
  import("@/routes/tasks/task-detail.js").then((m) => ({ default: m.TaskDetailPage })),
);
const TaskEditorPage = lazy(() =>
  import("@/routes/tasks/task-editor-page.js").then((m) => ({ default: m.TaskEditorPage })),
);
const UserDetailPage = lazy(() =>
  import("@/routes/users/user-detail.js").then((m) => ({ default: m.UserDetailPage })),
);
import { ThemePreview } from "@/components/theme-preview.js";
import { debugQuery, sessionQuery } from "@/lib/queries.js";
import type { Session } from "@/services/session.js";

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  notFoundComponent: lazyRouteComponent(() => import("@/routes/pages.js"), "NotFoundPage"),
});

/** Resolve the session once per navigation; a 401 simply means "signed out". */
async function loadSession(queryClient: QueryClient): Promise<Session | null> {
  try {
    return await queryClient.ensureQueryData(sessionQuery);
  } catch {
    return null;
  }
}

/** An already-signed-in user has no business on an auth screen. */
async function redirectIfSignedIn({ context }: { context: RouterContext }): Promise<void> {
  if (await loadSession(context.queryClient)) throw redirect({ to: "/" });
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // `redirect` is where the guard wanted to send the user before it bounced them.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: redirectIfSignedIn,
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  beforeLoad: redirectIfSignedIn,
  component: RegisterPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  beforeLoad: redirectIfSignedIn,
  component: lazyRouteComponent(
    () => import("@/routes/auth/forgot-password.js"),
    "ForgotPasswordPage",
  ),
});

/** The token arrives in the emailed link; an absent one is handled by the page. */
const tokenSearch = (search: Record<string, unknown>): { token?: string } => ({
  token: typeof search.token === "string" ? search.token : undefined,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: tokenSearch,
  component: function ResetPasswordRoute() {
    return <ResetPasswordPage token={resetPasswordRoute.useSearch().token} />;
  },
});

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invite",
  validateSearch: tokenSearch,
  component: function AcceptInviteRoute() {
    return <AcceptInvitePage token={acceptInviteRoute.useSearch().token} />;
  },
});

/** Everything inside the shell requires a session. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ context, location }) => {
    const session = await loadSession(context.queryClient);
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    // The API refuses every route but /me until the password is changed, so any
    // other page would render nothing but errors. Send them where they can fix it.
    if (session.passwordExpired && location.pathname !== "/profile") {
      throw redirect({ to: "/profile", search: { tab: "security" } });
    }

    // Same again for a two-factor requirement that has run out of grace: the API is
    // refusing everything else, and the enrolment lives on the security tab. Inside
    // the grace period nothing is redirected — the banner in the shell does the
    // asking, because taking somebody's work away a week early is not the deal.
    // Optional, deliberately: this reads a field off a payload that arrives over the
    // wire, and a session cached by an older build — or fetched mid-sign-in — has no
    // `twoFactor` at all. Throwing here does not fail loudly, it aborts the
    // navigation, which surfaces as a blank ERR_ABORTED with nothing pointing back
    // to this line.
    if (session.twoFactor?.overdue && location.pathname !== "/profile") {
      throw redirect({ to: "/profile", search: { tab: "security" } });
    }

    return { session };
  },
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/routes/pages.js"), "DashboardPage"),
});

const forbiddenRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/403",
  component: lazyRouteComponent(() => import("@/routes/pages.js"), "ForbiddenPage"),
});

/**
 * A `beforeLoad` that sends the caller to /403 rather than a blank screen when
 * they lack `permission` — matching what the API would answer anyway.
 */
/** A route open to anybody holding at least one of these — see `requirePermission`. */
export function requireAnyPermission(permissions: readonly Permission[]) {
  return async ({ context }: { context: RouterContext }): Promise<void> => {
    const session = await loadSession(context.queryClient);
    if (!session) throw redirect({ to: "/login" });
    const who = { permissions: session.permissions, isSuperadmin: session.isSuperadmin };
    if (!permissions.some((permission) => can(who, permission))) throw redirect({ to: "/403" });
  };
}

export function requirePermission(permission: Permission) {
  return async ({ context }: { context: RouterContext }): Promise<void> => {
    const session = await loadSession(context.queryClient);
    if (!session) throw redirect({ to: "/login" });
    const allowed = can(
      { permissions: session.permissions, isSuperadmin: session.isSuperadmin },
      permission,
    );
    if (!allowed) throw redirect({ to: "/403" });
  };
}

/**
 * The Queues screens need BOTH a permission and the server switch.
 *
 * `QUEUE_ADMIN=off` means the API never mounted the routes, so a person holding
 * `queues:view` would reach a page whose every request 404s. Sending them to /403
 * is not quite the truth either, but it is the honest one of the two available:
 * they cannot go there.
 */
function requireQueueAdmin(permission: Permission) {
  return async ({ context }: { context: RouterContext }): Promise<void> => {
    const session = await loadSession(context.queryClient);
    if (!session) throw redirect({ to: "/login" });
    if (session.queueAdmin === "off") throw redirect({ to: "/403" });
    const allowed = can(
      { permissions: session.permissions, isSuperadmin: session.isSuperadmin },
      permission,
    );
    if (!allowed) throw redirect({ to: "/403" });
  };
}

/** The `?tab=` param shared by every detail page; the page picks the default. */
const tabSearch = (search: Record<string, unknown>): { tab?: string } => ({
  tab: typeof search.tab === "string" ? search.tab : undefined,
});

/** Logs also accept a `requestId` so an audit event can deep-link to its lines. */
const logsSearch = (search: Record<string, unknown>): { tab?: string; requestId?: string } => ({
  tab: typeof search.tab === "string" ? search.tab : undefined,
  requestId: typeof search.requestId === "string" ? search.requestId : undefined,
});

const usersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/users",
  beforeLoad: requirePermission(PERMISSIONS.USERS_READ),
  component: lazyRouteComponent(() => import("@/routes/users/users-list.js"), "UsersListPage"),
});

const userCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/users/new",
  beforeLoad: requirePermission(PERMISSIONS.USERS_CREATE),
  component: lazyRouteComponent(
    () => import("@/routes/users/user-create-page.js"),
    "UserCreatePage",
  ),
});

const userDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/users/$userId",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.USERS_READ),
  component: function UserDetailRoute() {
    const { userId } = userDetailRoute.useParams();
    const { tab } = userDetailRoute.useSearch();
    return <UserDetailPage userId={userId} tab={tab ?? "profile"} />;
  },
});

const groupsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/groups",
  beforeLoad: requirePermission(PERMISSIONS.GROUPS_READ),
  component: lazyRouteComponent(() => import("@/routes/groups/groups-list.js"), "GroupsListPage"),
});

const groupDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/groups/$groupId",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.GROUPS_READ),
  component: function GroupDetailRoute() {
    const { groupId } = groupDetailRoute.useParams();
    const { tab } = groupDetailRoute.useSearch();
    return <GroupDetailPage groupId={groupId} tab={tab ?? "members"} />;
  },
});

const rolesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/roles",
  beforeLoad: requirePermission(PERMISSIONS.ROLES_READ),
  component: lazyRouteComponent(() => import("@/routes/roles/roles-list.js"), "RolesListPage"),
});

const roleCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/roles/new",
  beforeLoad: requirePermission(PERMISSIONS.ROLES_CREATE),
  component: () => <RoleEditorPage mode="create" />,
});

const roleEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/roles/$roleId/edit",
  beforeLoad: requirePermission(PERMISSIONS.ROLES_UPDATE),
  component: function RoleEdit() {
    const { roleId } = roleEditRoute.useParams();
    return <RoleEditorPage mode="edit" roleId={roleId} />;
  },
});

const roleCloneRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/roles/$roleId/clone",
  beforeLoad: requirePermission(PERMISSIONS.ROLES_CLONE),
  component: function RoleClone() {
    const { roleId } = roleCloneRoute.useParams();
    return <RoleEditorPage mode="clone" roleId={roleId} />;
  },
});

// Declared after /roles/new and the /$roleId/* pairs so the static and longer paths
// win; this is the bare "look at one role" page.
const roleDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/roles/$roleId",
  beforeLoad: requirePermission(PERMISSIONS.ROLES_READ),
  component: function RoleDetail() {
    const { roleId } = roleDetailRoute.useParams();
    return <RoleDetailPage roleId={roleId} />;
  },
});

const designationsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/designations",
  beforeLoad: requirePermission(PERMISSIONS.DESIGNATIONS_READ),
  component: lazyRouteComponent(
    () => import("@/routes/designations/designations-list.js"),
    "DesignationsListPage",
  ),
});

const designationCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/designations/new",
  beforeLoad: requirePermission(PERMISSIONS.DESIGNATIONS_CREATE),
  component: () => <DesignationEditorPage mode="create" />,
});

const designationEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/designations/$designationId/edit",
  beforeLoad: requirePermission(PERMISSIONS.DESIGNATIONS_UPDATE),
  component: function DesignationEdit() {
    const { designationId } = designationEditRoute.useParams();
    return <DesignationEditorPage mode="edit" designationId={designationId} />;
  },
});

// Shift catalogue. Managing shifts is shifts:manage; the schedule calendar (a later
// phase) is shifts:read. `/shifts/new` is static, matched before the `$shiftId` route.
const shiftsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/shifts",
  beforeLoad: requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  component: lazyRouteComponent(() => import("@/routes/shifts/shifts-list.js"), "ShiftsListPage"),
});
const shiftCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/shifts/new",
  beforeLoad: requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  component: () => <ShiftEditorPage mode="create" />,
});
const shiftEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/shifts/$shiftId/edit",
  beforeLoad: requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  component: function ShiftEdit() {
    const { shiftId } = shiftEditRoute.useParams();
    return <ShiftEditorPage mode="edit" shiftId={shiftId} />;
  },
});
const scheduleRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/schedule",
  beforeLoad: requirePermission(PERMISSIONS.SHIFTS_READ),
  component: lazyRouteComponent(() => import("@/routes/shifts/schedule-page.js"), "SchedulePage"),
});
// Shift-change requests. `/schedule/changes/new` is static, matched before nothing
// dynamic here, but kept explicit for clarity.
const shiftChangeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/schedule/changes",
  beforeLoad: requirePermission(PERMISSIONS.SHIFTS_READ),
  component: lazyRouteComponent(
    () => import("@/routes/shifts/shift-change-page.js"),
    "ShiftChangePage",
  ),
});
const shiftChangeNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/schedule/changes/new",
  beforeLoad: requirePermission(PERMISSIONS.SHIFTS_READ),
  component: lazyRouteComponent(
    () => import("@/routes/shifts/shift-change-request-page.js"),
    "ShiftChangeRequestPage",
  ),
});

// Routines. `/routines` is the member's occurrences; `/routines/manage` is the owner's.
// Static `/routines/manage/new` is matched before the `$routineId` route.
const myRoutinesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/routines",
  beforeLoad: requirePermission(PERMISSIONS.ROUTINES_READ),
  component: lazyRouteComponent(() => import("@/routes/routines/my-routines.js"), "MyRoutinesPage"),
});
const teamRoutinesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/routines/manage",
  beforeLoad: requirePermission(PERMISSIONS.ROUTINES_MANAGE),
  component: lazyRouteComponent(
    () => import("@/routes/routines/team-routines.js"),
    "TeamRoutinesPage",
  ),
});
const routineNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/routines/manage/new",
  beforeLoad: requirePermission(PERMISSIONS.ROUTINES_MANAGE),
  component: () => <RoutineEditorPage mode="create" />,
});
const routineDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/routines/manage/$routineId",
  beforeLoad: requirePermission(PERMISSIONS.ROUTINES_MANAGE),
  component: function RoutineDetail() {
    return <RoutineDetailPage routineId={routineDetailRoute.useParams().routineId} />;
  },
});
const routineEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/routines/manage/$routineId/edit",
  beforeLoad: requirePermission(PERMISSIONS.ROUTINES_MANAGE),
  component: function RoutineEdit() {
    return <RoutineEditorPage mode="edit" routineId={routineEditRoute.useParams().routineId} />;
  },
});

const reportsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/journal",
  // An `authorId` in the URL pre-filters the table to one person's entries — this is
  // how the leaderboard links a name to "their reports".
  validateSearch: (search: Record<string, unknown>): { authorId?: string } => ({
    authorId: typeof search.authorId === "string" ? search.authorId : undefined,
  }),
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_READ),
  component: function JournalList() {
    const { authorId } = reportsRoute.useSearch();
    return <JournalListPage authorId={authorId} />;
  },
});

/**
 * "My day" was the journal's first tab, so every visit to the journal — including
 * a link to a particular entry's list — landed on a screenful of summary tiles
 * first. It answers a different question from "find me that entry", so it is its
 * own page under Work.
 */
const myDayRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/my-day",
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_READ),
  component: lazyRouteComponent(() => import("@/routes/journal/my-day-page.js"), "MyDayPage"),
});

// Generated reports. The list and the run/view are reports:view; creating and
// editing custom views are reports:manage. `/reports/new` is static, so it is matched
// before the `$viewId` param route.
const reportsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/reports",
  beforeLoad: requireAnyPermission(ALL_REPORT_VIEW_PERMISSIONS),
  component: lazyRouteComponent(
    () => import("@/routes/reports/reports-list.js"),
    "ReportsListPage",
  ),
});
const reportNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/reports/new",
  beforeLoad: requirePermission(PERMISSIONS.REPORTS_MANAGE),
  component: function ReportNew() {
    return <ReportWorkspace mode="new" />;
  },
});
const reportLeaderboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/reports/leaderboard",
  beforeLoad: requirePermission(PERMISSIONS.LEADERBOARD_VIEW),
  component: lazyRouteComponent(
    () => import("@/routes/reports/leaderboard-page.js"),
    "LeaderboardPage",
  ),
});
// The self-serve points page — held by every role via points:read.
const myPointsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/points",
  beforeLoad: requirePermission(PERMISSIONS.POINTS_READ),
  component: lazyRouteComponent(() => import("@/routes/points/my-points.js"), "MyPointsPage"),
});
const reportViewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/reports/$viewId",
  beforeLoad: requireAnyPermission(ALL_REPORT_VIEW_PERMISSIONS),
  component: function ReportView() {
    const { viewId } = reportViewRoute.useParams();
    return <ReportWorkspace mode="view" viewId={viewId} />;
  },
});
const reportViewEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/reports/$viewId/edit",
  beforeLoad: requirePermission(PERMISSIONS.REPORTS_MANAGE),
  component: function ReportViewEdit() {
    const { viewId } = reportViewEditRoute.useParams();
    return <ReportWorkspace mode="edit" viewId={viewId} />;
  },
});

const reviewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/review",
  // `journal:read`, not `journal:appraise`. The page carries two halves now: a
  // manager's queue, and your own work waiting on somebody else — and the people
  // who most need the second are exactly the ones who cannot appraise.
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_READ),
  component: lazyRouteComponent(() => import("@/routes/journal/review-page.js"), "ReviewPage"),
});

const reportCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/journal/new",
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_CREATE),
  // `?taskId=` arrives when the editor is opened by completing a task.
  validateSearch: (search: Record<string, unknown>): { taskId?: string } =>
    typeof search.taskId === "string" ? { taskId: search.taskId } : {},
  component: function ReportCreate() {
    const { taskId } = reportCreateRoute.useSearch();
    return <JournalEntryEditorPage mode="create" taskId={taskId} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/tasks",
  beforeLoad: requirePermission(PERMISSIONS.TASKS_READ),
  component: lazyRouteComponent(() => import("@/routes/tasks/tasks-list.js"), "TasksListPage"),
});

const taskCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/tasks/new",
  beforeLoad: requirePermission(PERMISSIONS.TASKS_CREATE),
  component: () => <TaskEditorPage mode="create" />,
});

const taskEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/tasks/$taskId/edit",
  beforeLoad: requirePermission(PERMISSIONS.TASKS_UPDATE),
  component: function TaskEdit() {
    const { taskId } = taskEditRoute.useParams();
    return <TaskEditorPage mode="edit" taskId={taskId} />;
  },
});

const taskDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/tasks/$taskId",
  beforeLoad: requirePermission(PERMISSIONS.TASKS_READ),
  component: function TaskDetail() {
    const { taskId } = taskDetailRoute.useParams();
    return <TaskDetailPage taskId={taskId} />;
  },
});

const reportEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/journal/$reportId/edit",
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_READ),
  component: function ReportEdit() {
    const { reportId } = reportEditRoute.useParams();
    return <JournalEntryEditorPage mode="edit" reportId={reportId} />;
  },
});

const reportDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/journal/$reportId",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_READ),
  component: function JournalEntryDetail() {
    const { reportId } = reportDetailRoute.useParams();
    const { tab } = reportDetailRoute.useSearch();
    return <JournalEntryDetailPage reportId={reportId} tab={tab} />;
  },
});

const organizationRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/organization",
  beforeLoad: requirePermission(PERMISSIONS.DEPARTMENTS_READ),
  component: lazyRouteComponent(
    () => import("@/routes/organization/organization-page.js"),
    "OrganizationPage",
  ),
});

const departmentsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/departments",
  beforeLoad: requirePermission(PERMISSIONS.DEPARTMENTS_READ),
  component: lazyRouteComponent(
    () => import("@/routes/departments/departments-page.js"),
    "DepartmentsPage",
  ),
});

const departmentCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/departments/new",
  beforeLoad: requirePermission(PERMISSIONS.DEPARTMENTS_CREATE),
  component: () => <DepartmentEditorPage mode="create" />,
});

const departmentEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/departments/$departmentId/edit",
  beforeLoad: requirePermission(PERMISSIONS.DEPARTMENTS_UPDATE),
  component: function DepartmentEdit() {
    const { departmentId } = departmentEditRoute.useParams();
    return <DepartmentEditorPage mode="edit" departmentId={departmentId} />;
  },
});

const departmentDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/departments/$departmentId",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.DEPARTMENTS_READ),
  component: function DepartmentDetailRoute() {
    const { departmentId } = departmentDetailRoute.useParams();
    const { tab } = departmentDetailRoute.useSearch();
    return <DepartmentDetailPage departmentId={departmentId} tab={tab ?? "members"} />;
  },
});

const companiesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/companies",
  beforeLoad: requirePermission(PERMISSIONS.COMPANIES_READ),
  component: lazyRouteComponent(
    () => import("@/routes/companies/companies-list.js"),
    "CompaniesListPage",
  ),
});

const companyDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/companies/$companyId",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.COMPANIES_READ),
  component: function CompanyDetailRoute() {
    const { companyId } = companyDetailRoute.useParams();
    const { tab } = companyDetailRoute.useSearch();
    return <CompanyDetailPage companyId={companyId} tab={tab ?? "locations"} />;
  },
});

const assetsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/assets",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.ASSETS_READ),
  component: function AssetsRoute() {
    const { tab } = assetsRoute.useSearch();
    return <AssetsPage tab={tab ?? "tree"} />;
  },
});

// The cartridges module. Guarded by permission like everything else; whether the
// company uses it at all is a separate question the API answers with a 404, and
// the sidebar answers by leaving the entry out.
const cartridgesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/cartridges",
  beforeLoad: requirePermission(PERMISSIONS.PARTS_READ),
  component: lazyRouteComponent(
    () => import("@/routes/parts/cartridges-list.js"),
    "CartridgesListPage",
  ),
});

const cartridgeSetupRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/cartridges/setup",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.PARTS_READ),
  component: function CartridgeSetupRoute() {
    const { tab } = cartridgeSetupRoute.useSearch();
    return <CartridgeSetupPage tab={tab ?? "models"} />;
  },
});

const partDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/cartridges/$partId",
  beforeLoad: requirePermission(PERMISSIONS.PARTS_READ),
  component: function PartDetailRoute() {
    const { partId } = partDetailRoute.useParams();
    return <PartDetailPage partId={partId} />;
  },
});

const devicesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/devices",
  beforeLoad: requirePermission(PERMISSIONS.DEVICES_READ),
  component: lazyRouteComponent(
    () => import("@/routes/devices/devices-list.js"),
    "DevicesListPage",
  ),
});

const deviceCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/devices/new",
  beforeLoad: requirePermission(PERMISSIONS.DEVICES_CREATE),
  component: () => <DeviceEditorPage mode="create" />,
});

const deviceEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/devices/$deviceId/edit",
  beforeLoad: requirePermission(PERMISSIONS.DEVICES_READ),
  component: function DeviceEdit() {
    const { deviceId } = deviceEditRoute.useParams();
    return <DeviceEditorPage mode="edit" deviceId={deviceId} />;
  },
});

const downtimeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/downtime",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.DOWNTIME_READ),
  component: function DowntimeRoute() {
    const { tab } = downtimeRoute.useSearch();
    return <DowntimePage tab={tab ?? "pending"} />;
  },
});

const analyticsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/analytics",
  // analytics:view, not reports:read — the aggregates cover everyone's reports, so
  // the page is Manager-and-up. The sidebar filters on the same permission, so a
  // Member is never offered a page the API would refuse.
  beforeLoad: requirePermission(PERMISSIONS.ANALYTICS_VIEW),
  component: lazyRouteComponent(
    () => import("@/routes/analytics/analytics-page.js"),
    "AnalyticsPage",
  ),
});

/**
 * Insights is LAZY, unlike every other route here.
 *
 * It is the only page that pulls in a charting library, and loading Recharts for
 * somebody who never opens it would put ~100 KB gzipped in front of the sign-in
 * screen. Splitting one route is worth it exactly when that route carries a
 * dependency the rest of the app does not.
 */
const insightsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/insights",
  // Its own permission, not analytics:view — the charts can go on a wall screen
  // without also handing over the reliability figures.
  beforeLoad: requirePermission(PERMISSIONS.INSIGHTS_VIEW),
  component: lazyRouteComponent(() => import("@/routes/insights/insights-page.js"), "InsightsPage"),
});

const reportConfigRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/journal-config",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.JOURNAL_READ),
  component: function ReportConfigRoute() {
    const { tab } = reportConfigRoute.useSearch();
    return <ReportConfigPage tab={tab ?? "severities"} />;
  },
});

// Tags have their own screen because they have their own permission — see
// routes/tags/tags-page.tsx. `tags:manage` guards it: reading tags needs nothing
// (they are drawn on every entry), but this page exists to change them.
const tagsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/tags",
  beforeLoad: requirePermission(PERMISSIONS.TAGS_MANAGE),
  component: lazyRouteComponent(() => import("@/routes/tags/tags-page.js"), "TagsPage"),
});

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/settings",
  validateSearch: tabSearch,
  beforeLoad: requirePermission(PERMISSIONS.SETTINGS_READ),
  component: function SettingsRoute() {
    const { tab } = settingsRoute.useSearch();
    return <SettingsPage tab={tab ?? "auth"} />;
  },
});

const ssoRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/settings/sso",
  beforeLoad: requirePermission(PERMISSIONS.SETTINGS_READ),
  component: lazyRouteComponent(() => import("@/routes/settings/sso-page.js"), "SsoPage"),
});

const logsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/logs",
  validateSearch: logsSearch,
  beforeLoad: requirePermission(PERMISSIONS.LOGS_VIEW),
  component: function LogsRoute() {
    const { tab, requestId } = logsRoute.useSearch();
    return <LogsPage tab={tab ?? "search"} requestId={requestId} />;
  },
});

const messagesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/messages",
  beforeLoad: requirePermission(PERMISSIONS.LOGS_VIEW),
  component: lazyRouteComponent(() => import("@/routes/messages/messages-page.js"), "MessagesPage"),
});

const auditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/audit",
  beforeLoad: requirePermission(PERMISSIONS.AUDIT_VIEW),
  component: lazyRouteComponent(() => import("@/routes/audit/audit-page.js"), "AuditPage"),
});
const backupsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/backups",
  beforeLoad: requirePermission(PERMISSIONS.BACKUPS_MANAGE),
  component: lazyRouteComponent(() => import("@/routes/backups/backups-page.js"), "BackupsPage"),
});

/** Your own account. No permission needed: it acts only on the caller. */
/**
 * The full notifications list.
 *
 * No permission: everybody has an inbox, and it holds only their own rows. It is
 * reached from the bell rather than the sidebar — see the page's own note.
 */
const notificationsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/notifications",
  component: lazyRouteComponent(
    () => import("@/routes/notifications/notifications-page.js"),
    "NotificationsPage",
  ),
});

const queuesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/queues",
  beforeLoad: requireQueueAdmin(PERMISSIONS.QUEUES_VIEW),
  component: lazyRouteComponent(() => import("@/routes/queues/queues-page.js"), "QueuesPage"),
});

const queueDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/queues/$queueId",
  beforeLoad: requireQueueAdmin(PERMISSIONS.QUEUES_VIEW),
  component: function QueueDetailRoute() {
    const { queueId } = queueDetailRoute.useParams();
    return <QueueDetailPage queueId={queueId} />;
  },
});

const profileRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/profile",
  validateSearch: tabSearch,
  component: function ProfileRoute() {
    const { tab } = profileRoute.useSearch();
    return <ProfilePage tab={tab ?? "profile"} />;
  },
});

/** Developer previews: reachable only while debug mode is on. */
async function requireDebugMode({ context }: { context: RouterContext }): Promise<void> {
  const status = await context.queryClient.ensureQueryData(debugQuery).catch(() => null);
  if (!status?.active) throw redirect({ to: "/403" });
}

const themeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/dev/theme",
  beforeLoad: requireDebugMode,
  component: ThemePreview,
});

const tableDemoRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/dev/table",
  beforeLoad: requireDebugMode,
  component: lazyRouteComponent(() => import("@/routes/dev/table-demo.js"), "TableDemoPage"),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  // Token screens stay reachable while signed in: an invited user may already
  // have a session in another tab.
  resetPasswordRoute,
  acceptInviteRoute,
  authedRoute.addChildren([
    indexRoute,
    forbiddenRoute,
    usersRoute,
    userCreateRoute,
    userDetailRoute,
    groupsRoute,
    groupDetailRoute,
    rolesRoute,
    roleCreateRoute,
    roleEditRoute,
    roleCloneRoute,
    roleDetailRoute,
    reportsRoute,
    myDayRoute,
    reviewRoute,
    reportsListRoute,
    reportNewRoute,
    reportLeaderboardRoute,
    reportViewEditRoute,
    reportViewRoute,
    scheduleRoute,
    shiftChangeRoute,
    shiftChangeNewRoute,
    shiftsRoute,
    shiftCreateRoute,
    shiftEditRoute,
    myRoutinesRoute,
    teamRoutinesRoute,
    routineNewRoute,
    routineDetailRoute,
    routineEditRoute,
    myPointsRoute,
    tasksRoute,
    taskCreateRoute,
    taskEditRoute,
    taskDetailRoute,
    reportCreateRoute,
    reportEditRoute,
    reportDetailRoute,
    assetsRoute,
    // `/cartridges/setup` before `/cartridges/$partId`, or "setup" is read as an id.
    cartridgesRoute,
    cartridgeSetupRoute,
    partDetailRoute,
    devicesRoute,
    deviceCreateRoute,
    deviceEditRoute,
    downtimeRoute,
    analyticsRoute,
    insightsRoute,
    organizationRoute,
    designationsRoute,
    designationCreateRoute,
    designationEditRoute,
    departmentsRoute,
    departmentCreateRoute,
    departmentEditRoute,
    departmentDetailRoute,
    companiesRoute,
    companyDetailRoute,
    reportConfigRoute,
    tagsRoute,
    settingsRoute,
    ssoRoute,
    logsRoute,
    backupsRoute,
    messagesRoute,
    auditRoute,
    notificationsRoute,
    queuesRoute,
    queueDetailRoute,
    profileRoute,
    themeRoute,
    tableDemoRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultNotFoundComponent: lazyRouteComponent(() => import("@/routes/pages.js"), "NotFoundPage"),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
