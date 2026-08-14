// Author: Brijesh Dave <https://github.com/brijeshdave>
// React entry point: mount the app into #root.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App.js";
import "@/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
