import ReactDOM from "react-dom/client";
import App from "./App";
import "../../../../packages/ui/src/styles/global.css";
import "../styles/app.css";
import "../styles/automation-wb.css";
import "../styles/chat.css";
import "../styles/polish.css";
import { MarkdownHostProvider } from "@openbuddy/markdown/host";
import { webMarkdownHost } from "../shared/markdown-host";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <MarkdownHostProvider host={webMarkdownHost}>
    <App />
  </MarkdownHostProvider>
);
