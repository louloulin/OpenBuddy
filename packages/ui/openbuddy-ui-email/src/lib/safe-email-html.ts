const SAFE_EMAIL_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "HR",
  "I", "LI", "OL", "P", "PRE", "S", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY",
  "TD", "TH", "THEAD", "TR", "U", "UL",
]);
const SAFE_EMAIL_ATTRIBUTES = new Set(["align", "colspan", "dir", "href", "rowspan", "target", "title"]);
const REMOVED_EMAIL_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "LINK", "META", "BASE"]);

function safeEmailUrl(value: string): string | undefined {
  try {
    const url = new URL(value, "https://openbuddy.invalid");
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Email bodies are provider-controlled HTML. Keep the renderer deliberately
 * small: remote images, CSS, forms, scripts and unknown attributes are not
 * part of the email display contract.
 */
export function sanitizeEmailHtml(value: string): string {
  if (typeof DOMParser === "undefined") return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const document = new DOMParser().parseFromString(value, "text/html");
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!SAFE_EMAIL_TAGS.has(element.tagName)) {
      if (element.tagName === "IMG") element.replaceWith(document.createTextNode("[远程图片已阻止]"));
      else if (REMOVED_EMAIL_TAGS.has(element.tagName)) element.remove();
      else element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || !SAFE_EMAIL_ATTRIBUTES.has(name)) element.removeAttribute(attribute.name);
      else if (name === "href") {
        const safeUrl = safeEmailUrl(attribute.value);
        if (safeUrl) element.setAttribute("href", safeUrl);
        else element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName === "A" && element.getAttribute("target") === "_blank") element.setAttribute("rel", "noopener noreferrer");
  }
  return document.body.innerHTML;
}
