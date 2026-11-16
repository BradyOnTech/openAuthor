import React from "react";
import ReactDOM from "react-dom/client";
import { AppV2 } from "./AppV2";
// Fonts ship inside the app, so a local-first editor makes no network request
// to render its own interface and looks the same offline.
import "@fontsource-variable/outfit";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "./design-system-v2.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppV2 />
  </React.StrictMode>
);
