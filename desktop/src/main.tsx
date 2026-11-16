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
import { reserveTitleBar } from "./nativeWindow";

reserveTitleBar();
// Fetch the prose typeface now rather than when the first scene is drawn, so
// a page of prose is not set in a fallback face and then set again.
for (const style of ["", "italic "]) void document.fonts?.load(`${style}1em "Literata Variable"`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppV2 />
  </React.StrictMode>
);
