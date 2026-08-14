// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turns a thrown value into something worth showing a user. Every form uses this
// so an unexpected failure never renders as "[object Object]" or a blank alert.
import { ApiError } from "@/services/http.js";

const FALLBACK = "Something went wrong. Please try again.";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // The API's messages are written for users; a bare status code is not.
    return error.message || FALLBACK;
  }
  if (error instanceof Error && error.message) return error.message;
  return FALLBACK;
}

/** The request id to quote when reporting a problem, when the API returned one. */
export function errorRequestId(error: unknown): string | null {
  return error instanceof ApiError ? error.requestId : null;
}
