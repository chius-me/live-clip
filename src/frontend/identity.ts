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
  "#c2410c",
  "#a16207",
  "#4d7c0f",
  "#0f766e",
  "#1d4ed8",
  "#6d28d9",
  "#be185d",
  "#b45309",
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
