import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { schedulePrefetch } from "./translate/prefetch";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// In the installed/production app, download the whole dictionary for offline use.
if (import.meta.env.PROD) schedulePrefetch();
