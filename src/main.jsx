import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ErrorBoundary } from "./components.jsx";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { initTheme } from "./theme.js";

initTheme();

registerSW({ immediate: true });
createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);
