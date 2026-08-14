// Author: Brijesh Dave <https://github.com/brijeshdave>
// Class-name helper: merges conditional classes and resolves Tailwind conflicts so
// callers can safely override a component's defaults via `className`.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
