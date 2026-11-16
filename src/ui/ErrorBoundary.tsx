import { Component, type ErrorInfo, type ReactNode } from "react";
import { call } from "../core/backend";

/** Keeps one broken widget from taking the dock down. */
export class ErrorBoundary extends Component<{ name: string; fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack);
    call("app", "log", { level: "error", message: `widget ${this.props.name} crashed: ${error.message}` }).catch(() => {});
  }

  render() {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <div className="grid h-full w-full place-items-center rounded-tile bg-bad/15 text-[10px] text-bad" title={`${this.props.name} stopped working`}>
            !
          </div>
        )
      );
    }
    return this.props.children;
  }
}
