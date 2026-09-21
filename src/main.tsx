import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="loading-screen" role="alert">
          <div>
            <strong>We could not open this workspace view.</strong>
            <p>Your session is safe. Return to the dashboard to continue.</p>
            <button className="button primary" onClick={() => location.assign("/")}>
              Return to dashboard
            </button>
          </div>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
