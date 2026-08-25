export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function hashesEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const width = Math.max(leftBytes.byteLength, rightBytes.byteLength, 1);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;
  for (let i = 0; i < width; i += 1) {
    const a = i < leftBytes.byteLength ? leftBytes[i] : 0;
    const b = i < rightBytes.byteLength ? rightBytes[i] : 0;
    diff |= a ^ b;
  }
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
