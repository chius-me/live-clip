const ADJECTIVES = [
  "Amber",
  "Cedar",
  "Coral",
  "Dusk",
  "Ivory",
  "Maple",
  "Moss",
  "Pearl",
  "Sage",
  "Slate",
];

const ANIMALS = [
  "Fox",
  "Heron",
  "Lynx",
  "Otter",
  "Puma",
  "Raven",
  "Seal",
  "Sparrow",
  "Stoat",
  "Wren",
];

const COLORS = [
  "#8d5a2b",
  "#5c4a32",
  "#3f5c38",
  "#6a4e3a",
  "#8c2f2f",
  "#4a5c6a",
  "#7a6238",
  "#3a3936",
];

export type UserIdentity = {
  name: string;
  color: string;
};

function pick<T>(list: readonly T[]): T {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return list[bytes[0] % list.length];
}

export function getOrCreateIdentity(): UserIdentity {
  try {
    const raw = sessionStorage.getItem("liveclip.user");
    if (raw) {
      const parsed = JSON.parse(raw) as UserIdentity;
      if (parsed.name && parsed.color) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors.
  }
  const identity = {
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  };
  try {
    sessionStorage.setItem("liveclip.user", JSON.stringify(identity));
  } catch {
    // Ignore storage errors.
  }
  return identity;
}
