import React, { Component, ErrorInfo, ReactNode } from "react";
import { TactileButton } from "./TactileButton";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "var(--color-bg-app)",
            color: "var(--color-text-primary)",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "20px", opacity: 0.3 }}>
            ⚠
          </div>
          <h1
            style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px" }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "var(--color-text-secondary)",
              marginBottom: "24px",
              maxWidth: "400px",
            }}
          >
            The application encountered an unexpected error. Please restart the
            application.
          </p>
          <pre
            style={{
              fontSize: "11px",
              color: "var(--color-text-tertiary)",
              background: "rgba(255,255,255,0.05)",
              padding: "12px 16px",
              borderRadius: "6px",
              maxWidth: "500px",
              overflow: "auto",
              textAlign: "left",
            }}
          >
            {this.state.error?.message || "Unknown error"}
          </pre>
          <TactileButton
            onClick={() => window.location.reload()}
            variant="primary"
            style={{ marginTop: "24px" }}
          >
            Reload Application
          </TactileButton>
        </div>
      );
    }

    return this.props.children;
  }
}
