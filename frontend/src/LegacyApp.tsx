// The workspace and account pages (renter dashboard, bookings, owner workspace, checkout, sign-in, account) in
// their current design, as one lazy chunk: the redesigned public pages never download them.
import { Link, Route, Routes } from "react-router-dom";
import { Favorites } from "./Favorites";
import { Checkout } from "./Checkout";
import AccountScreen from "./AccountScreen";
import { SignIn } from "./Auth";
import { Layout, RequireSession } from "./Layout";
import { Bookings } from "./Bookings";
import { Dashboard } from "./Dashboard";
import { Fleet, MaintenanceIndex, MaintenancePage, Values } from "./Owner";
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
            path="checkout/:id"
            element={
              <RequireSession>
                <Checkout />
              </RequireSession>
            }
          />
          <Route path="sign-in" element={<SignIn />} />
          <Route path="register" element={<AccountScreen screen="signup" />} />
          <Route
            path="verify-email/:key"
            element={<AccountScreen screen="verify" />}
          />
          <Route
            path="reset-password"
            element={<AccountScreen screen="request-reset" />}
          />
          <Route
            path="reset-password/:key"
            element={<AccountScreen screen="reset" />}
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
            path="owner"
            element={
              <RequireSession>
                <Dashboard owner />
              </RequireSession>
            }
          />
          <Route
            path="bookings/:id"
            element={
              <RequireSession>
                <Bookings />
              </RequireSession>
            }
          />
          <Route
            path="bookings"
            element={
              <RequireSession>
                <Bookings />
              </RequireSession>
            }
          />
          <Route
            path="owner/requests"
            element={
              <RequireSession>
                <Bookings owner />
              </RequireSession>
            }
          />
          <Route
            path="owner/fleet"
            element={
              <RequireSession>
                <Fleet />
              </RequireSession>
            }
          />
          <Route
            path="owner/fleet/:id/maintenance"
            element={
              <RequireSession>
                <MaintenancePage />
              </RequireSession>
            }
          />
          <Route
            path="owner/maintenance"
            element={
              <RequireSession>
                <MaintenanceIndex />
              </RequireSession>
            }
          />
          <Route
            path="owner/value"
            element={
              <RequireSession>
                <Values />
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
