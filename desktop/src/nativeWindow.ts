// The Mac desktop window has no system title bar: the page runs to the top
// edge and the window buttons sit over it. The page draws its own strip there
// (`TitleBar`) and everything else starts below `--titlebar-height`. Browsers
// and other platforms keep their own window chrome, so the height stays zero.
import { isApplePlatform } from "./platformKeys";

function inDesktopApp(): boolean {
  return typeof window !== "undefined"
    && typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

export function hasOverlayTitleBar(): boolean {
  return inDesktopApp() && isApplePlatform();
}

/**
 * The desktop window stays hidden until the first screen is ready, so it never
 * appears blank or unstyled. Called once the app has rendered; the stylesheet
 * is in by the window's `load` event. If this never arrives the shell shows
 * the window anyway after a short deadline.
 */
export function announceFirstScreen(): void {
  if (!inDesktopApp()) return;
  const announce = () => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("main_window_ready"))
      .catch(() => undefined);
  };
  if (document.readyState === "complete") announce();
  else window.addEventListener("load", announce, { once: true });
}

/** Reserve the strip before the first paint so nothing shifts once React mounts. */
export function reserveTitleBar(): void {
  if (hasOverlayTitleBar()) document.documentElement.dataset.titlebar = "overlay";
}

/** Dim the title while another app is in front, as every Mac window does. */
export function trackWindowFocus(): () => void {
  const root = document.documentElement;
  const sync = () => root.toggleAttribute("data-window-inactive", !document.hasFocus());
  sync();
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  return () => {
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
    root.removeAttribute("data-window-inactive");
  };
}
