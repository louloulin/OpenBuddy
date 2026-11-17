import ReactDOM from "react-dom/client";
import App from "./App";
import "../../../../packages/ui/src/styles/global.css";
import "../styles/app.css";
import "../styles/automation-wb.css";
import "../styles/chat.css";
import "../styles/polish.css";
import { MarkdownHostProvider } from "@openbuddy/markdown/host";
import { webMarkdownHost } from "../shared/markdown-host";
import { PairingGate } from "./h5/PairingGate";
import { installPairing, isBrowserHost, savedPairing } from "./h5/boot";
import { applyUiPreferences } from "../features/settings/preferences";

applyUiPreferences();

const container = document.getElementById("root")!;

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
      <App />
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
