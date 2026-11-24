import { Component } from "react";
import type { ReactNode } from "react";
import { RoadSign } from "./states";

/** A page that throws while rendering shows a Diversion sign with a reload, instead of a blank screen. */
export default class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="od-page" role="alert">
        <RoadSign kind="diversion" title="This page couldn't load."
          action={<button type="button" className="od-cta" onClick={() => window.location.reload()}>Reload the page</button>}>
          Something went wrong while drawing it. Reloading usually gets you back on the road.
        </RoadSign>
      </div>
    );
  }
}
