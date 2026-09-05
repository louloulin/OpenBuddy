import { Theme, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const rpcTheme = new Theme(
  Object.fromEntries([
    "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
    "thinkingText", "searchMatchText", "userMessageText", "customMessageText", "customMessageLabel", "toolTitle",
    "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote",
    "mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment",
    "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator",
    "syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh",
    "thinkingMax", "bashMode",
  ].map((name) => [name, "#ffffff"])) as unknown as ConstructorParameters<typeof Theme>[0],
  Object.fromEntries(["selectedBg", "scrollbarThumb", "searchMatchBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"].map((name) => [name, "#000000"])) as unknown as ConstructorParameters<typeof Theme>[1],
  "truecolor",
  { name: "openbuddy-rpc" },
);

export interface OpenBuddyRpcUiContextOptions {
  sessionId: string;
  select: (title: string, options: string[]) => Promise<string | undefined>;
  confirm: (title: string, message: string) => Promise<boolean>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
  editor: (title: string, prefill?: string) => Promise<string | undefined>;
  emit: (payload: Record<string, unknown>) => void;
  getEditorText: () => string;
  setEditorText: (text: string) => void;
  getToolsExpanded: () => boolean;
  setToolsExpanded: (expanded: boolean) => void;
}

export function createOpenBuddyRpcUiContext(options: OpenBuddyRpcUiContextOptions): ExtensionUIContext {
  const emit = (payload: Record<string, unknown>) => options.emit({ sessionId: options.sessionId, ...payload });

  return {
    select: options.select,
    confirm: options.confirm,
    input: options.input,
    notify: (message, type = "info") => emit({ method: "notify", message, type }),
    onTerminalInput: () => () => undefined,
    setStatus: (key, text) => emit({ method: "setStatus", key, text }),
    setWorkingMessage: (message) => emit({ method: "setWorkingMessage", message }),
    setWorkingVisible: (visible) => emit({ method: "setWorkingVisible", visible }),
    setWorkingIndicator: (indicator) => emit({ method: "setWorkingIndicator", options: indicator }),
    setHiddenThinkingLabel: (label) => emit({ method: "setHiddenThinkingLabel", label }),
    setWidget: (key, content, widgetOptions) => {
      if (content === undefined || Array.isArray(content)) emit({ method: "setWidget", key, content, options: widgetOptions });
    },
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: (title) => emit({ method: "setTitle", title }),
    custom: async <T>(): Promise<T> => undefined as T,
    pasteToEditor: (text) => options.setEditorText(`${options.getEditorText()}${text}`),
    setEditorText: (text) => options.setEditorText(text),
    getEditorText: options.getEditorText,
    editor: options.editor,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    get theme() {
      return rpcTheme;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Theme switching not supported in RPC mode" }),
    getToolsExpanded: () => options.getToolsExpanded(),
    setToolsExpanded: (expanded) => options.setToolsExpanded(expanded),
  };
}
