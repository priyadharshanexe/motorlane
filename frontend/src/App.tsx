import { Favorites } from "./Favorites";
import { Checkout } from "./Checkout";
import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes, Link } from "react-router-dom";
import AccountScreen from "./AccountScreen";
import { SignIn } from "./Auth";
import { Layout, RequireSession } from "./Layout";
import { Bookings } from "./Bookings";
import { Dashboard } from "./Dashboard";
import { Fleet, MaintenanceIndex, MaintenancePage, Values } from "./Owner";

// The design-concept lab is its own chunk and is not linked from the app.
const Lab = lazy(() => import("./lab/Lab"));
// The redesigned public pages (slice 1 of the Odometer redesign): their own shell, fonts and motion, each a lazy chunk.
const OdoLayout = lazy(() => import("./odo/OdoLayout").then(m => ({ default: m.OdoLayout })));
const Home = lazy(() => import("./odo/Home").then(m => ({ default: m.Home })));
const Catalog = lazy(() => import("./odo/Catalog").then(m => ({ default: m.Catalog })));
const VehicleDetail = lazy(() => import("./odo/VehicleDetail").then(m => ({ default: m.VehicleDetail })));

function OdoShell() {
  return <Suspense fallback={<div className="od-boot" />}><OdoLayout><Suspense fallback={<div className="od-page-loading" style={{ minHeight: "100vh" }} />}><Outlet /></Suspense></OdoLayout></Suspense>;
}

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
      <Route path="lab" element={<Suspense fallback={null}><Lab /></Suspense>} />
      <Route element={<OdoShell />}>
        <Route index element={<Home />} />
        <Route path="vehicles" element={<Catalog />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
      </Route>
      <Route path="*" element={
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
      } />
      </Routes>
    </BrowserRouter>
  );
}
