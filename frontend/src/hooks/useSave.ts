import { useRef, useState } from "react";
import { createSaveLock } from "../lib/saveFlow";
import { messageFor } from "../lib/api";

/** A synchronous lock also covers repeated submits before React re-renders. */
export function useSave() {
  const locked = useRef(createSaveLock());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const save = async (work: () => Promise<boolean>) => {
    if (!locked.current.acquire()) return false;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await work();
      if (!saved) setSaveError("Chưa lưu được. Nội dung vẫn được giữ lại, bạn có thể thử lại.");
      return saved;
    } catch (error) {
      setSaveError(messageFor(error));
      return false;
    } finally {
      locked.current.release();
      setSaving(false);
    }
  };
  const closeWhenIdle = (close: () => void) => () => {
    if (!locked.current.locked) close();
  };
  return { saving, saveError, save, closeWhenIdle };
}
