import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";

// The redesigned public pages (slice 1 of the Odometer redesign): their own shell, fonts and motion, each a lazy chunk.
const OdoLayout = lazy(() => import("./odo/OdoLayout").then(m => ({ default: m.OdoLayout })));
const Home = lazy(() => import("./odo/Home").then(m => ({ default: m.Home })));
const Catalog = lazy(() => import("./odo/Catalog").then(m => ({ default: m.Catalog })));
const VehicleDetail = lazy(() => import("./odo/VehicleDetail").then(m => ({ default: m.VehicleDetail })));
// The workspace pages keep their current design until their slice; they load as one separate chunk.
// Slice 2: checkout, payment, trips and auth.
const Checkout = lazy(() => import("./odo/Checkout").then(m => ({ default: m.Checkout })));
const Trips = lazy(() => import("./odo/Trips").then(m => ({ default: m.Trips })));
const TripDetail = lazy(() => import("./odo/Trips").then(m => ({ default: m.TripDetail })));
const SignInPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.SignInPage })));
const RegisterPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.RegisterPage })));
const VerifyEmailPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.VerifyEmailPage })));
const ResetPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.ResetPage })));
const OwnerHome = lazy(() => import("./odo/Owner").then(m => ({ default: m.OwnerHome })));
const OwnerRequests = lazy(() => import("./odo/Owner").then(m => ({ default: m.OwnerRequests })));
const OwnerBooking = lazy(() => import("./odo/Owner").then(m => ({ default: m.OwnerBooking })));
const OwnerValue = lazy(() => import("./odo/Owner").then(m => ({ default: m.OwnerValue })));
const OwnerFleet = lazy(() => import("./odo/OwnerFleet").then(m => ({ default: m.OwnerFleet })));
const OwnerMaintenanceIndex = lazy(() => import("./odo/OwnerFleet").then(m => ({ default: m.OwnerMaintenanceIndex })));
const OwnerMaintenance = lazy(() => import("./odo/OwnerFleet").then(m => ({ default: m.OwnerMaintenance })));
const Saved = lazy(() => import("./odo/Saved").then(m => ({ default: m.Saved })));
const Account = lazy(() => import("./odo/Account").then(m => ({ default: m.Account })));
const NotFound = lazy(() => import("./odo/states").then(m => ({ default: m.NotFound })));
const RequireSession = lazy(() => import("./odo/states").then(m => ({ default: m.RequireSession })));

// Start fetching the shell and the current page's chunk together at startup, instead of one after the other
// (shell, then page) as React would discover them: this removes a round trip from the first paint on slow networks.
if (typeof window !== "undefined") {
  const path = window.location.pathname.replace(/^\/app/, "");
  if (path === "" || path === "/") { import("./odo/OdoLayout"); import("./odo/Home"); }
  else if (/^\/vehicles\/?$/.test(path)) { import("./odo/OdoLayout"); import("./odo/Catalog"); }
  else if (/^\/vehicles\/\d+/.test(path)) { import("./odo/OdoLayout"); import("./odo/VehicleDetail"); }
}

function OdoShell() {
  return <Suspense fallback={<div className="od-boot" />}><OdoLayout><Suspense fallback={<div className="od-page-loading" style={{ minHeight: "100vh" }} />}><Outlet /></Suspense></OdoLayout></Suspense>;
}

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
      <Route element={<OdoShell />}>
        <Route index element={<Home />} />
        <Route path="vehicles" element={<Catalog />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="checkout/:id" element={<RequireSession><Checkout /></RequireSession>} />
        <Route path="bookings" element={<RequireSession><Trips /></RequireSession>} />
        <Route path="bookings/:id" element={<RequireSession><TripDetail /></RequireSession>} />
        <Route path="owner" element={<RequireSession><OwnerHome /></RequireSession>} />
        <Route path="owner/requests" element={<RequireSession><OwnerRequests /></RequireSession>} />
        <Route path="owner/bookings/:id" element={<RequireSession><OwnerBooking /></RequireSession>} />
        <Route path="owner/fleet" element={<RequireSession><OwnerFleet /></RequireSession>} />
        <Route path="owner/maintenance" element={<RequireSession><OwnerMaintenanceIndex /></RequireSession>} />
        <Route path="owner/fleet/:id/maintenance" element={<RequireSession><OwnerMaintenance /></RequireSession>} />
        <Route path="owner/value" element={<RequireSession><OwnerValue /></RequireSession>} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="verify-email/:key" element={<VerifyEmailPage />} />
        <Route path="reset-password" element={<ResetPage />} />
        <Route path="reset-password/:key" element={<ResetPage />} />
        <Route path="favorites" element={<RequireSession><Saved /></RequireSession>} />
        <Route path="account" element={<RequireSession><Account /></RequireSession>} />
        {/* the old renter dashboard: its trips and saved vehicles now have their own pages */}
        <Route path="dashboard" element={<Navigate to="/bookings" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Routes>
    </BrowserRouter>
  );
}
