export const ROOM_ID_BYTES = 16;
export const EDIT_SECRET_BYTES = 18;

/** 128-bit Base64URL without padding: 22 characters. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** 144-bit Base64URL without padding: 24 characters. */
export const EDIT_SECRET_PATTERN = /^[A-Za-z0-9_-]{24}$/;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function generateEditSecret(): string {
  const bytes = new Uint8Array(EDIT_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}

export function isValidEditSecret(secret: string): boolean {
  return EDIT_SECRET_PATTERN.test(secret);
}
