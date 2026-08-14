// Author: Brijesh Dave <https://github.com/brijeshdave>
// The shift catalogue — the named spans of the day (Morning, Night…) a department
// can be scheduled on. Small on purpose and company-wide, so it is a plain list
// rather than a paginated table; the schedule calendar draws its chips from here.
import {
  PERMISSIONS,
  formatMinutesOfDay,
  shiftDurationMinutes,
  type Shift,
} from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Clock, Plus } from "lucide-react";

import { Can } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { SHIFT_COLOR_CLASSES } from "@/routes/shifts/shift-colors.js";
import { fetchShifts } from "@/services/shifts.js";

/** "22:00 – 06:00 · 8h" — the window and how long it runs, overnight wrap included. */
function windowLabel(shift: Shift): string {
  const minutes = shiftDurationMinutes(shift.startMinute, shift.endMinute);
  const hours = minutes / 60;
  const length = Number.isInteger(hours) ? `${hours}h` : `${Math.floor(hours)}h ${minutes % 60}m`;
  return `${formatMinutesOfDay(shift.startMinute)} – ${formatMinutesOfDay(shift.endMinute)} · ${length}`;
}

export function ShiftsListPage() {
  const navigate = useNavigate();
  const shifts = useQuery({ queryKey: ["shifts"], queryFn: fetchShifts });

  return (
    <>
      <PageHeader
        title="Shifts"
        description="The named spans of the day your departments run on. Build them once here; the schedule calendar assigns people to them. Disabling a shift retires it without touching the schedules that used it."
        actions={
          <Can permission={PERMISSIONS.SHIFTS_MANAGE}>
            <Button size="sm" onClick={() => void navigate({ to: "/shifts/new" })}>
              <Plus className="h-4 w-4" />
              New shift
            </Button>
          </Can>
        }
      />

      {shifts.isLoading ? (
        <Spinner />
      ) : shifts.error ? (
        <ErrorAlert error={shifts.error} />
      ) : (shifts.data ?? []).length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No shifts yet"
          description="Create Morning, Evening, Night — whatever your departments run on."
        />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {(shifts.data ?? []).map((shift) => (
            <Link
              key={shift.id}
              to="/shifts/$shiftId/edit"
              params={{ shiftId: shift.id }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold",
                  SHIFT_COLOR_CLASSES[shift.color].chip,
                )}
              >
                {shift.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{shift.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {windowLabel(shift)}
              </span>
              <Badge tone={shift.status === "active" ? "success" : "neutral"}>
                {shift.status === "active" ? "active" : "disabled"}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
