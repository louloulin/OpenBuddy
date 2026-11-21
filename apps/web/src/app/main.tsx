import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "../../../../packages/ui/src/styles/global.css";
import "../styles/app.css";
import "../styles/automation-wb.css";
import "../styles/chat.css";
import "../styles/polish.css";
import "../styles/grok.css";
import { MarkdownHostProvider } from "@openbuddy/markdown/host";
import { webMarkdownHost } from "../shared/markdown-host";
import { PairingGate } from "./h5/PairingGate";
import { installPairing, isBrowserHost, savedPairing } from "./h5/boot";
import { applyUiPreferences } from "../features/settings/preferences";
import { applyLocale } from "../shared/i18n";
import { QuickInput } from "./quick/QuickInput";

applyUiPreferences();
applyLocale();

const container = document.getElementById("root")!;
/** 全局快速输入窗口 (W7.2): only the small composer, never the full app. */
const isQuickWindow = window.location.hash.startsWith("#/quick");

/**
 * Boot order matters: the renderer's api calls run as soon as App mounts, so
 * the browser transport has to exist first. Electron takes the preload path
 * (nothing to install); a browser with a saved credential gets its transport
 * immediately; a browser without one sees the pairing gate.
 */
function renderApp() {
  const root = ReactDOM.createRoot(container);
  root.render(
    <MarkdownHostProvider host={webMarkdownHost}>
      <ErrorBoundary scope={isQuickWindow ? "quick-input" : "app"}>
        {isQuickWindow ? <QuickInput /> : <App />}
      </ErrorBoundary>
    </MarkdownHostProvider>
  );
  return root;
}

if (!isBrowserHost()) {
  renderApp();
} else {
  const pairing = savedPairing();
  if (pairing) {
    installPairing(pairing);
    renderApp();
  } else {
    const root = ReactDOM.createRoot(container);
    root.render(
      <PairingGate
        onPaired={() => {
          root.unmount();
          renderApp();
        }}
      />
    );
  }
}
