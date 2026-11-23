import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";

// The design-concept lab is its own chunk and is not linked from the app.
const Lab = lazy(() => import("./lab/Lab"));
// The redesigned public pages (slice 1 of the Odometer redesign): their own shell, fonts and motion, each a lazy chunk.
const OdoLayout = lazy(() => import("./odo/OdoLayout").then(m => ({ default: m.OdoLayout })));
const Home = lazy(() => import("./odo/Home").then(m => ({ default: m.Home })));
const Catalog = lazy(() => import("./odo/Catalog").then(m => ({ default: m.Catalog })));
const VehicleDetail = lazy(() => import("./odo/VehicleDetail").then(m => ({ default: m.VehicleDetail })));
// The workspace pages keep their current design until their slice; they load as one separate chunk.
const LegacyApp = lazy(() => import("./LegacyApp"));
// Slice 2: checkout, payment, trips and auth.
const Checkout = lazy(() => import("./odo/Checkout").then(m => ({ default: m.Checkout })));
const Trips = lazy(() => import("./odo/Trips").then(m => ({ default: m.Trips })));
const TripDetail = lazy(() => import("./odo/Trips").then(m => ({ default: m.TripDetail })));
const SignInPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.SignInPage })));
const RegisterPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.RegisterPage })));
const VerifyEmailPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.VerifyEmailPage })));
const ResetPage = lazy(() => import("./odo/AuthPages").then(m => ({ default: m.ResetPage })));
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
      <Route path="lab" element={<Suspense fallback={null}><Lab /></Suspense>} />
      <Route element={<OdoShell />}>
        <Route index element={<Home />} />
        <Route path="vehicles" element={<Catalog />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="checkout/:id" element={<RequireSession><Checkout /></RequireSession>} />
        <Route path="bookings" element={<RequireSession><Trips /></RequireSession>} />
        <Route path="bookings/:id" element={<RequireSession><TripDetail /></RequireSession>} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="verify-email/:key" element={<VerifyEmailPage />} />
        <Route path="reset-password" element={<ResetPage />} />
        <Route path="reset-password/:key" element={<ResetPage />} />
      </Route>
      <Route path="*" element={<Suspense fallback={<div className="od-boot" />}><LegacyApp /></Suspense>} />
      </Routes>
    </BrowserRouter>
  );
}
