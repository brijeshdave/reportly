// Author: Brijesh Dave <https://github.com/brijeshdave>
// Catches render errors, reports them into the server log pipeline (same request-id
// trace as the API), and shows a recoverable fallback instead of a blank page.
import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button, EmptyState } from "@/components/ui/primitives.js";
import { reportClientLog } from "@/services/logs.js";

interface Props {
  children: ReactNode;
  /** Identifies where the boundary sits, e.g. "app" or "reports-table". */
  boundary?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void reportClientLog({
      level: "error",
      msg: error.message || "Unhandled UI error",
      context: {
        boundary: this.props.boundary ?? "app",
        stack: error.stack,
        componentStack: info.componentStack,
        url: window.location.href,
      },
    });
  }

  private readonly reset = () => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          title="Something went wrong"
          description="The error has been reported. You can try again, or reload the page."
          action={
            <Button size="sm" onClick={this.reset}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
}
