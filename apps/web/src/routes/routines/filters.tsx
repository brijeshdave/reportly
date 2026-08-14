// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shared filter/sort controls for the routines pages: a compact labelled select, a
// search box, and the row that lines them up above a list or grid. Kept presentational —
// each page owns which filters it shows and the logic that applies them.
import { Search } from "lucide-react";
import type { ReactNode } from "react";

import { Input, Select } from "@/components/ui/form.js";
import { cn } from "@/lib/cn.js";

/** The row a page's filter/sort controls sit in, above its list. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end gap-2 pt-2", className)}>{children}</div>;
}

/** A compact labelled dropdown for one filter or the sort order. */
export function ToolbarSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-[8.5rem]"
      >
        {children}
      </Select>
    </label>
  );
}

/** A search box that filters by free text. */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">Search</span>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 min-w-[12rem] pl-8"
        />
      </div>
    </label>
  );
}

/** Toggle the direction of whatever sort a page applies. */
export type SortDir = "asc" | "desc";
