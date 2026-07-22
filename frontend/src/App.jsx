import React from "react";
import { Routes, Route } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import Overview from "./views/Overview.jsx";
import Trace from "./views/Trace.jsx";
import Bank from "./views/Bank.jsx";
import Lab from "./views/Lab.jsx";
import Logistics from "./views/Logistics.jsx";
import Explainer from "./views/Explainer.jsx";

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/trace" element={<Trace />} />
        <Route path="/trace/:serial" element={<Trace />} />
        <Route path="/bank" element={<Bank />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/logistics" element={<Logistics />} />
        <Route path="/explainer" element={<Explainer />} />
      </Routes>
    </Shell>
  );
}
