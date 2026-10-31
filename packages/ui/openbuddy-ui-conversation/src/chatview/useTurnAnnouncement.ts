/**
 * useTurnAnnouncement — text for a screen-reader status region that speaks
 * once when a turn finishes. The timeline itself is not aria-live: that
 * would read out every streamed token.
 */
import { useEffect, useRef, useState } from "react";

export function useTurnAnnouncement(streaming: boolean, doneLabel: string): string {
  const [announcement, setAnnouncement] = useState("");
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (streaming) setAnnouncement("");
    else if (wasStreamingRef.current) setAnnouncement(doneLabel);
    wasStreamingRef.current = streaming;
  }, [streaming, doneLabel]);
  return announcement;
}
