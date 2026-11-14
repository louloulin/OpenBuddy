import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** A callback whose identity never changes but always runs the latest closure (keeps memoized rows still). */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Find the App top bar's right slot (rendered by App before ChatView mounts). */
export function useTopbarSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setSlot(document.getElementById("chat-topbar-slot")); }, []);
  return slot;
}
