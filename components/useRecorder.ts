"use client";

import { useCallback, useRef, useState } from "react";

/** Hold-to-talk recording with MediaRecorder; resolves with the audio blob when stopped. */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const done = useRef<((blob: Blob | null) => void) | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = chunks.current.length ? new Blob(chunks.current, { type: rec.mimeType }) : null;
        done.current?.(blob);
        done.current = null;
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setError("Microphone permission is needed to record.");
    }
  }, []);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const rec = recorder.current;
        setRecording(false);
        if (!rec || rec.state === "inactive") return resolve(null);
        done.current = resolve;
        rec.stop();
        recorder.current = null;
      }),
    [],
  );

  return { recording, error, start, stop };
}
