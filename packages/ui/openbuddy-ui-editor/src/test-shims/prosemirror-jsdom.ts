/**
 * ProseMirror ↔ jsdom 兼容垫片(仅供测试使用)。
 *
 * jsdom 实现了 `Element.getBoundingClientRect`,但没有实现
 * `Range.getClientRects`,而 ProseMirror 的 `coordsAtPos` 会通过
 * `singleRect(target, bias)` 同时调用二者的 `getClientRects`。
 * 结果就是:任何触发 `focus()` → `scrollToSelection` 的交互在 jsdom 里
 * 都会抛 `TypeError: target.getClientRects is not a function`。
 *
 * 线上(Electron / Chromium)没有这个问题,所以修复放在测试侧而不是产品代码:
 * 用全零矩形把这两个 API 补齐,让布局相关的调用安全地退化成 no-op。
 */

const ZERO_RECT: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} as DOMRect;

function zeroRectList(): DOMRectList {
  const list = [ZERO_RECT] as unknown as DOMRectList & DOMRect[];
  list.item = (index: number) => list[index] ?? null;
  return list;
}

/** 幂等地给 Range / Element 补上 getClientRects / getBoundingClientRect。 */
export function installProseMirrorJsdomShims(): void {
  if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
    Range.prototype.getClientRects = zeroRectList;
    Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  }
  if (typeof Element !== "undefined" && !Element.prototype.getClientRects) {
    Element.prototype.getClientRects = zeroRectList;
    Element.prototype.getBoundingClientRect = () => ZERO_RECT;
  }
  if (typeof document !== "undefined") {
    const caretRangeFromPoint = (document as Document & {
      caretRangeFromPoint?: () => Range | null;
    }).caretRangeFromPoint;
    if (!caretRangeFromPoint) {
      (document as Document & { caretRangeFromPoint?: () => Range | null }).caretRangeFromPoint =
        () => null;
    }
  }
}

installProseMirrorJsdomShims();
