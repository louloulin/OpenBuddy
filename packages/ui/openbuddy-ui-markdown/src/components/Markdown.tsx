import {
  Component,
  Suspense,
  lazy,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { defaultUrlTransform } from "react-markdown";

// `components` only needs to be rebuilt when the *identity* of its actual
// callback/scalar deps changes — not whenever the parent passes a fresh
// `config` object with stable inner fields. This hook keeps a stable snapshot
// reference for each sub-field we actually read inside the components map, so
// the heavy `<ReactMarkdown>` parser isn't invalidated on every parent render
// (which would otherwise re-parse the whole AST during streaming).
function useStableConfigParts(config?: MarkdownConfig) {
  const lastRef = useRef<{
    config: MarkdownConfig | undefined;
    parts: {
      pathClickHandler: MarkdownConfig["pathClickHandler"];
      resolveCode: MarkdownConfig["resolveCode"];
      openCodeLink: MarkdownConfig["openCodeLink"];
      renderInlineCodePathIcon: MarkdownConfig["renderInlineCodePathIcon"];
      onApplyCode: MarkdownConfig["onApplyCode"];
      onCodeBlockAction: MarkdownConfig["onCodeBlockAction"];
      codeBlockActions: MarkdownConfig["codeBlockActions"];
      imageUrlResolver: MarkdownConfig["imageUrlResolver"];
      imageUrlResolverAsync: MarkdownConfig["imageUrlResolverAsync"];
      onImageResolveError: MarkdownConfig["onImageResolveError"];
      onLinkClick: MarkdownConfig["onLinkClick"];
      onDownloadMermaid: MarkdownConfig["onDownloadMermaid"];
      onPreviewMermaid: MarkdownConfig["onPreviewMermaid"];
      expandThreshold: MarkdownConfig["expandThreshold"];
    };
  }>({ config: undefined, parts: undefined as never });
  if (!config) {
    if (lastRef.current.config !== undefined) {
      lastRef.current = { config: undefined, parts: undefined as never };
    }
    return undefined;
  }
  const prev = lastRef.current.config;
  if (!prev) {
    const parts = {
      pathClickHandler: config.pathClickHandler,
      resolveCode: config.resolveCode,
      openCodeLink: config.openCodeLink,
      renderInlineCodePathIcon: config.renderInlineCodePathIcon,
      onApplyCode: config.onApplyCode,
      onCodeBlockAction: config.onCodeBlockAction,
      codeBlockActions: config.codeBlockActions,
      imageUrlResolver: config.imageUrlResolver,
      imageUrlResolverAsync: config.imageUrlResolverAsync,
      onImageResolveError: config.onImageResolveError,
      onLinkClick: config.onLinkClick,
      onDownloadMermaid: config.onDownloadMermaid,
      onPreviewMermaid: config.onPreviewMermaid,
      expandThreshold: config.expandThreshold,
    };
    lastRef.current = { config, parts };
    return parts;
  }
  let parts = lastRef.current.parts;
  let changed = false;
  const next: typeof parts = {
    pathClickHandler: config.pathClickHandler,
    resolveCode: config.resolveCode,
    openCodeLink: config.openCodeLink,
    renderInlineCodePathIcon: config.renderInlineCodePathIcon,
    onApplyCode: config.onApplyCode,
    onCodeBlockAction: config.onCodeBlockAction,
    codeBlockActions: config.codeBlockActions,
    imageUrlResolver: config.imageUrlResolver,
    imageUrlResolverAsync: config.imageUrlResolverAsync,
    onImageResolveError: config.onImageResolveError,
    onLinkClick: config.onLinkClick,
    onDownloadMermaid: config.onDownloadMermaid,
    onPreviewMermaid: config.onPreviewMermaid,
    expandThreshold: config.expandThreshold,
  };
  for (const k of Object.keys(next) as Array<keyof typeof next>) {
    if (next[k] !== prev[k]) {
      changed = true;
      break;
    }
  }
  if (changed) {
    parts = next;
    lastRef.current = { config, parts };
  }
  return parts;
}

// Heavy markdown pipeline modules (react-markdown, remark/rehype plugins, lowlight,
// katex CSS) are loaded on demand the first time a Markdown instance actually
// renders. Keeping these out of the module-top-level imports means the chunk
// they live in (see electron.vite.config.ts manualChunks "markdown"/"katex") is
// only fetched once a real conversation message needs it, instead of blocking
// the initial React mount.

type ReactMarkdownComponent = typeof import("react-markdown").default;
type RemarkPlugin = unknown;
type RehypePlugin = unknown;
type LowlightCommon = Record<string, unknown>;
type LinkifyItInstance = import("linkify-it").LinkifyIt;

import { preprocessMarkdown } from "./preprocess";
import { remarkCodeLanguage } from "./plugins/remark-code-language";
import { remarkLinkifyIt } from "./plugins/remark-linkify-it";
import { rehypeCodeBlock } from "./plugins/rehype-code-block";
import { rehypeInlineCode } from "./plugins/rehype-inline-code";
import { rehypeFixAutolinkBoundary } from "./plugins/rehype-fix-autolink-boundary";
import { MarkdownPre } from "./MarkdownPre";
// R6.6 — Lazy-load the Mermaid wrapper so its (small but non-zero) chunk
// plus its mermaid dep graph only ship when a fenced `mermaid` block is
// actually rendered. Falls back to the source-only view during the async
// chunk fetch; the wrapper's own `complete` gate already shows the raw
// code until the user is looking at a settled diagram.
const MarkdownPreMermaid = lazy(() =>
  import("./MarkdownPreMermaid").then((m) => ({ default: m.MarkdownPreMermaid })),
);
import { MarkdownInlineCode } from "./MarkdownInlineCode";
import type { MarkdownConfig, MarkdownProps } from "./types";

/* ---------- sanitize schema (hljs + katex/mathml) ---------- */

function buildSanitizeSchema(
  defaultSchema: MarkdownRuntime["defaultSchema"],
  config?: MarkdownConfig,
) {
  const schema = { ...defaultSchema };
  schema.attributes = {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className", "meta"],
    span: ["className", "style", "ariaHidden", "role"],
    div: ["className", "style"],
    pre: [...(defaultSchema.attributes?.pre || []), "className"],
    "*": [
      "className",
      "style",
      "ariaHidden",
      "role",
      "tabIndex",
      "id",
      "title",
    ],
    math: ["xmlns", "display", "alttext"],
    semantics: ["*"],
    annotation: ["encoding"],
    mrow: ["*"],
    msup: ["*"],
    msub: ["*"],
    msubsup: ["*"],
    mi: ["mathvariant"],
    mn: ["*"],
    mo: ["stretchy", "fence", "separator", "lspace", "rspace", "form"],
    mfrac: ["linethickness"],
    msqrt: ["*"],
    mroot: ["*"],
    munder: ["*"],
    mover: ["*"],
    munderover: ["*"],
    mtable: ["*"],
    mtr: ["*"],
    mtd: ["*"],
    mspace: ["width", "height", "depth"],
    mtext: ["*"],
    mstyle: ["*"],
    mpadded: ["*"],
    mphantom: ["*"],
  };
  schema.tagNames = [
    ...(defaultSchema.tagNames || []),
    "math",
    "semantics",
    "mrow",
    "msup",
    "mi",
    "mn",
    "mo",
    "mfrac",
    "msqrt",
    "mroot",
    "msubsup",
    "msub",
    "munder",
    "mover",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mspace",
    "mtext",
    "mstyle",
    "mpadded",
    "mphantom",
    "annotation",
    "maligngroup",
    "malignmark",
    "menclose",
    "merror",
    "mfenced",
    "mglyph",
    "mlabeledtr",
    "mlongdiv",
    "mmultiscripts",
    "mstack",
    "mscarries",
    "mscarry",
    "msgroup",
    "msline",
    "msrow",
    "maction",
  ];

  const extraSchemes = config?.customUrlSchemes?.map((s) => s.scheme) ?? [];
  schema.protocols = {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), ...extraSchemes],
  };
  if (config?.imageUrlResolver || config?.imageUrlResolverAsync) {
    schema.protocols = {
      ...schema.protocols,
      src: [
        ...(defaultSchema.protocols?.src || []),
        "file",
        "local-file",
        "blob",
      ],
    };
  }
  return schema;
}

/* ---------- error boundary ---------- */

const MAX_ERROR_RETRIES = 1;

type BoundaryProps = {
  fallbackText: string;
  remarkPlugins: unknown[];
  rehypePlugins: unknown[];
  components: Record<string, unknown>;
  urlTransform: (url: string) => string;
  ReactMarkdown: ReactMarkdownComponent;
  children: ReactNode;
};

type BoundaryState = {
  hasError: boolean;
  errorCount: number;
  retryKey: number;
};

class MarkdownErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, errorCount: 0, retryKey: 0 };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
    console.warn("[Markdown] DOM reconciliation error caught:", error.message);
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (this.state.hasError && prevProps.fallbackText !== this.props.fallbackText) {
      this.setState((prev) => ({
        hasError: false,
        errorCount: 0,
        retryKey: prev.retryKey + 1,
      }));
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.errorCount > MAX_ERROR_RETRIES) {
        return <pre className="md-fallback">{this.props.fallbackText}</pre>;
      }
      return (
        <this.props.ReactMarkdown
          key={`fallback-${this.state.retryKey}`}
          remarkPlugins={this.props.remarkPlugins as never}
          rehypePlugins={this.props.rehypePlugins as never}
          components={this.props.components as never}
          urlTransform={this.props.urlTransform}
        >
          {this.props.fallbackText}
        </this.props.ReactMarkdown>
      );
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}

/* ---------- image with async resolver ---------- */

function MarkdownImage({
  src,
  alt,
  config,
  ...imgProps
}: {
  src?: string;
  alt?: string;
  config?: MarkdownConfig;
} & React.ImgHTMLAttributes<HTMLImageElement>) {
  const syncResolved = src ? (config?.imageUrlResolver?.(src) ?? src) : src;
  const [resolvedSrc, setResolvedSrc] = useState(syncResolved);

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(syncResolved);
    if (!src || !config?.imageUrlResolverAsync) {
      return () => {
        cancelled = true;
      };
    }
    config
      .imageUrlResolverAsync(src)
      .then((asyncResolved) => {
        if (!cancelled && asyncResolved) setResolvedSrc(asyncResolved);
      })
      .catch((error) => {
        config.onImageResolveError?.(error, { src });
      });
    return () => {
      cancelled = true;
    };
  }, [config, src, syncResolved]);

  return <img src={resolvedSrc} alt={alt} {...imgProps} />;
}

/* ---------- main renderer ---------- */

type SanitizeSchemaProperty =
  | string
  | readonly string[]
  | readonly [string, ...(string | number | boolean | RegExp | null | undefined)[]];
type SanitizeSchema = {
  tagNames?: readonly string[] | null;
  attributes?:
    | Record<string, readonly SanitizeSchemaProperty[] | null>
    | null;
  protocols?: Record<string, readonly string[] | null | undefined> | null;
  clobber?: readonly string[] | null;
  clobberPrefix?: string | null;
  strip?: readonly string[] | null;
  ancestors?: Record<string, readonly string[]> | null;
  allowComments?: boolean | null;
  allowDoctypes?: boolean | null;
  default?: SanitizeSchema | null;
};

type MarkdownRuntime = {
  ReactMarkdown: typeof import("react-markdown").default;
  remarkGfm: unknown;
  remarkBreaks: unknown;
  remarkMath: unknown;
  rehypeHighlight: unknown;
  rehypeKatex: unknown;
  rehypeSanitize: unknown;
  defaultSchema: SanitizeSchema;
  common: Record<string, unknown>;
  LinkifyIt: typeof import("linkify-it").LinkifyIt;
};

let cachedRuntime: MarkdownRuntime | null = null;
let runtimePromise: Promise<MarkdownRuntime> | null = null;

async function loadMarkdownRuntime(): Promise<MarkdownRuntime> {
  if (cachedRuntime) return cachedRuntime;
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const [
        { default: ReactMarkdown },
        { default: remarkGfm },
        { default: remarkBreaks },
        { default: remarkMath },
        { default: rehypeHighlight },
        { default: rehypeKatex },
        { default: rehypeSanitize },
        { defaultSchema },
        { common },
        { LinkifyIt },
      ] = await Promise.all([
        import("react-markdown"),
        import("remark-gfm"),
        import("remark-breaks"),
        import("remark-math"),
        import("rehype-highlight"),
        import("rehype-katex"),
        import("rehype-sanitize"),
        import("rehype-sanitize"),
        import("lowlight"),
        import("linkify-it"),
      ]);
      await import("katex/dist/katex.min.css");
      const runtime: MarkdownRuntime = {
        ReactMarkdown,
        remarkGfm,
        remarkBreaks,
        remarkMath,
        rehypeHighlight,
        rehypeKatex,
        rehypeSanitize,
        defaultSchema,
        common,
        LinkifyIt,
      };
      cachedRuntime = runtime;
      return runtime;
    })();
  }
  return runtimePromise!;
}

function MarkdownInner({
  children,
  complete = true,
  markdownTheme = "legacy",
  config,
  theme = "light",
}: MarkdownProps) {
  const [runtime, setRuntime] = useState<MarkdownRuntime | null>(cachedRuntime);
  useEffect(() => {
    if (runtime) return;
    let cancelled = false;
    loadMarkdownRuntime()
      .then((loaded) => {
        if (!cancelled) setRuntime(loaded);
      })
      .catch((error) => {
        console.error("[markdown] failed to load runtime", error);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  if (!runtime) {
    const fallback = preprocessMarkdown(children ?? "");
    return (
      <div
        className="markdown-body md-font-size-fixed"
        data-md-theme={markdownTheme}
      >
        <pre>{fallback}</pre>
      </div>
    );
  }

  return (
    <MarkdownContent
      runtime={runtime}
      children={children}
      complete={complete}
      markdownTheme={markdownTheme}
      theme={theme}
      config={config}
    />
  );
}

type MarkdownContentProps = MarkdownProps & { runtime: MarkdownRuntime };

function MarkdownContent({
  runtime,
  children,
  complete = true,
  markdownTheme = "legacy",
  config,
  theme = "light",
}: MarkdownContentProps) {
  const {
    ReactMarkdown,
    remarkGfm,
    remarkBreaks,
    remarkMath,
    rehypeKatex,
    rehypeHighlight,
    rehypeSanitize,
    defaultSchema,
    common,
    LinkifyIt,
  } = runtime;

  const preprocessed = useMemo(
    () => preprocessMarkdown(children ?? ""),
    [children],
  );

  const stableParts = useStableConfigParts(config);

  const sanitizeSchema = useMemo(
    () => buildSanitizeSchema(runtime.defaultSchema, config),
    [runtime, config],
  );

  const linkify = useMemo(() => {
    const instance = new LinkifyIt({ fuzzyLink: false, fuzzyIP: false });
    config?.customUrlSchemes?.forEach((s) => {
      if (!s.linkifyValidate) return;
      instance.add(`${s.scheme}:`, { validate: s.linkifyValidate });
    });
    return instance;
  }, [config?.customUrlSchemes]);

  const urlTransform = useMemo(() => {
    const schemes = config?.customUrlSchemes;
    if (!schemes?.length) return defaultUrlTransform;
    const prefixes = schemes.map((s) => `${s.scheme}:`);
    return (value: string) =>
      prefixes.some((p) => value.toLowerCase().startsWith(p))
        ? value
        : defaultUrlTransform(value);
  }, [config?.customUrlSchemes]);

  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkBreaks,
      [remarkMath, { singleDollarTextMath: true }] as const,
      [remarkLinkifyIt, { linkify }] as const,
      remarkCodeLanguage,
    ],
    [linkify],
  );

  /**
   * Plugin order matters:
   * 1. sanitize before katex (katex emits MathML + styles)
   * 2. code-block / inline-code before highlight (extract raw content)
   * 3. highlight last
   */
  const rehypePlugins = useMemo(
    () => [
      [rehypeSanitize, sanitizeSchema] as const,
      rehypeFixAutolinkBoundary,
      rehypeCodeBlock,
      rehypeInlineCode,
      [
        rehypeKatex,
        {
          strict: false,
          throwOnError: false,
          errorColor: "#cc0000",
          macros: {
            "\\RR": "\\mathbb{R}",
            "\\NN": "\\mathbb{N}",
            "\\ZZ": "\\mathbb{Z}",
            "\\QQ": "\\mathbb{Q}",
            "\\CC": "\\mathbb{C}",
          },
        },
      ] as const,
      [rehypeHighlight, { languages: { ...common } }] as const,
    ],
    [sanitizeSchema],
  );

  const components = useMemo(
    () => ({
      pre: ({
        children: preChildren,
        node,
        ...preProps
      }: {
        children?: ReactNode;
        node?: { data?: Record<string, unknown> };
      } & React.HTMLAttributes<HTMLPreElement>) => {
        const language = node?.data?.language as string | undefined;
        const content = node?.data?.content as string | undefined;
        const meta = node?.data?.meta as string | undefined;

        if (language === "mermaid") {
          return (
            // R6.6 — Suspense fallback for the lazy chunk. Falls back to
            // the static source view until the mermaid wrapper resolves.
            // MarkdownPreMermaid's own `complete` gate already shows the
            // raw code while streaming, so users never see a blank.
            <Suspense
              fallback={
                <pre className="md-code-pre md-mermaid-source">
                  <code className="language-mermaid">{content ?? ""}</code>
                </pre>
              }
            >
              <MarkdownPreMermaid
                content={content}
                complete={complete}
                language={language}
                theme={theme}
                onDownloadMermaid={stableParts?.onDownloadMermaid}
                onPreviewMermaid={stableParts?.onPreviewMermaid}
                codeBlockActions={stableParts?.codeBlockActions}
                requestId={config?.requestId}
                onCodeBlockAction={stableParts?.onCodeBlockAction}
                onApplyCode={stableParts?.onApplyCode}
                expandThreshold={stableParts?.expandThreshold}
              >
                {preChildren}
              </MarkdownPreMermaid>
            </Suspense>
          );
        }

        if (language === "latex") {
          return (
            <MarkdownPre
              {...preProps}
              language={language}
              code={content}
              meta={meta}
              pathClickHandler={stableParts?.pathClickHandler}
              codeBlockActions={stableParts?.codeBlockActions}
              onApplyCode={stableParts?.onApplyCode}
              isLatex
              requestId={config?.requestId}
              onCodeBlockAction={stableParts?.onCodeBlockAction}
            >
              {preChildren}
            </MarkdownPre>
          );
        }

        return (
          <MarkdownPre
            {...preProps}
            language={language}
            code={content}
            meta={meta}
            pathClickHandler={stableParts?.pathClickHandler}
            codeBlockActions={stableParts?.codeBlockActions}
            onApplyCode={stableParts?.onApplyCode}
            requestId={config?.requestId}
            onCodeBlockAction={stableParts?.onCodeBlockAction}
          >
            {preChildren}
          </MarkdownPre>
        );
      },
      table: ({
        children: tableChildren,
        ...tableProps
      }: React.TableHTMLAttributes<HTMLTableElement> & {
        children?: ReactNode;
      }) => (
        <div className="md-table-wrapper">
          <table {...tableProps}>{tableChildren}</table>
        </div>
      ),
      code: ({
        children: codeChildren,
        node,
        className,
        ...codeProps
      }: {
        children?: ReactNode;
        node?: { data?: { inline?: boolean } };
        className?: string;
      } & React.HTMLAttributes<HTMLElement>) => {
        if (!node?.data?.inline) {
          return (
            <code className={className} {...codeProps}>
              {codeChildren}
            </code>
          );
        }
        return (
          <MarkdownInlineCode
            pathClickHandler={stableParts?.pathClickHandler}
            resolveCode={stableParts?.resolveCode}
            openCodeLink={stableParts?.openCodeLink}
            requestId={config?.requestId}
            renderPathIcon={stableParts?.renderInlineCodePathIcon}
            className={className}
            {...codeProps}
          >
            {codeChildren}
          </MarkdownInlineCode>
        );
      },
      a: ({
        href,
        title,
        children: aChildren,
        ...aProps
      }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
        children?: ReactNode;
      }) => {
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          const onLinkClick = stableParts?.onLinkClick;
          if (onLinkClick) {
            if (
              onLinkClick({
                href: href || "",
                title,
                children: aChildren,
                event: e,
              }) === false
            ) {
              e.preventDefault();
              e.stopPropagation();
            }
          }
        };
        return (
          <a
            href={href}
            title={title}
            onClick={handleClick}
            target="_blank"
            rel="noopener noreferrer"
            {...aProps}
          >
            {aChildren}
          </a>
        );
      },
      ...(stableParts?.imageUrlResolver || stableParts?.imageUrlResolverAsync
        ? {
            img: ({
              src,
              alt,
              ...imgProps
            }: React.ImgHTMLAttributes<HTMLImageElement>) => (
              <MarkdownImage src={src} alt={alt} config={config} {...imgProps} />
            ),
          }
        : {}),
    }),
    // Depend on the *stable* inner refs, not the outer `config` object.
    // The parent recreates `config` every render even when its inner callbacks
    // are stable (useMemo([cwd, sessionId, onToast]) — `onToast` is fresh per
    // parent render), which used to bust this memo and re-run the full
    // remark/rehype/sanitize pipeline for every streamed chunk.
    [
      stableParts?.pathClickHandler,
      stableParts?.resolveCode,
      stableParts?.openCodeLink,
      stableParts?.renderInlineCodePathIcon,
      stableParts?.onApplyCode,
      stableParts?.onCodeBlockAction,
      stableParts?.codeBlockActions,
      stableParts?.imageUrlResolver,
      stableParts?.imageUrlResolverAsync,
      stableParts?.onImageResolveError,
      stableParts?.onLinkClick,
      stableParts?.onDownloadMermaid,
      stableParts?.onPreviewMermaid,
      stableParts?.expandThreshold,
      complete,
      theme,
    ],
  );

  const themeClass =
    markdownTheme === "loose" || markdownTheme === "reasoning"
      ? "markdown-body md-font-size-fixed"
      : "markdown-body";

  return (
    <div className={themeClass} data-md-theme={markdownTheme}>
      <MarkdownErrorBoundary
        fallbackText={preprocessed}
        remarkPlugins={remarkPlugins as unknown[]}
        rehypePlugins={rehypePlugins as unknown[]}
        components={components as Record<string, unknown>}
        urlTransform={urlTransform}
        ReactMarkdown={ReactMarkdown}
      >
        <ReactMarkdown
          remarkPlugins={remarkPlugins as never}
          rehypePlugins={rehypePlugins as never}
          components={components as never}
          urlTransform={urlTransform}
        >
          {preprocessed}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  );
}

export async function preloadMarkdownRuntime(): Promise<void> {
  await loadMarkdownRuntime();
}

export const Markdown = memo(MarkdownInner, (prev, next) => {
  return (
    prev.children === next.children &&
    prev.complete === next.complete &&
    prev.theme === next.theme &&
    prev.config === next.config &&
    prev.markdownTheme === next.markdownTheme
  );
});

export type { MarkdownProps, MarkdownConfig, MarkdownTheme } from "./types";
