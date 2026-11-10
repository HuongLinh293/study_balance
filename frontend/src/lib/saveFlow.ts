/** Lock immediately, without waiting for a React state update. */
export function createSaveLock() {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() { locked = false; },
    get locked() { return locked; },
  };
}

/** Applying the plan can succeed independently of persisting the busy period. */
export async function applyAndSaveBusy(
  apply: () => Promise<unknown>,
  saveBusy?: () => Promise<boolean>,
): Promise<boolean> {
  await apply();
  if (!saveBusy) return true;
  try {
    return await saveBusy();
  } catch {
    return false;
  }
}
