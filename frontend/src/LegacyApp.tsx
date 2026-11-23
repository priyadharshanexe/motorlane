// The workspace and account pages (renter dashboard, bookings, owner workspace, checkout, sign-in, account) in
// their current design, as one lazy chunk: the redesigned public pages never download them.
import { Link, Route, Routes } from "react-router-dom";
import { Favorites } from "./Favorites";
import AccountScreen from "./AccountScreen";
import { Layout, RequireSession } from "./Layout";
import { Dashboard } from "./Dashboard";
import "./legacy-fonts.css";

export default function LegacyApp() {
  return (
      <Layout>
        <Routes>
          <Route
            path="favorites"
            element={
              <RequireSession>
                <Favorites />
              </RequireSession>
            }
          />
          <Route
            path="account"
            element={
              <RequireSession>
                <AccountScreen screen="account" />
              </RequireSession>
            }
          />
          <Route
            path="dashboard"
            element={
              <RequireSession>
                <Dashboard />
              </RequireSession>
            }
          />
          <Route
            path="*"
            element={
              <>
                <h1>Page not found</h1>
                <Link to="/">Return home</Link>
              </>
            }
          />
        </Routes>
      </Layout>
  );
}
