const storageKey = (roomId: string) => `liveclip.secret.${roomId}`;

export function readStoredSecret(roomId: string): string | null {
  try {
    return localStorage.getItem(storageKey(roomId));
  } catch {
    return null;
  }
}

export function storeSecret(roomId: string, secret: string): void {
  try {
    localStorage.setItem(storageKey(roomId), secret);
  } catch {
    // Ignore quota / private mode.
  }
}

export function resolveEditSecret(roomId: string): string | null {
  const fromHash = window.location.hash.replace(/^#/, "").trim();
  if (fromHash) {
    storeSecret(roomId, fromHash);
    return fromHash;
  }
  return readStoredSecret(roomId);
}
