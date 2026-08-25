export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;

export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export const Y_TEXT_KEY = "content";
export const Y_META_KEY = "meta";
export const Y_LANGUAGE_KEY = "language";

export const DEFAULT_LANGUAGE = "plaintext";

export type ConnectionRole = "reader" | "editor";

export type AuthRequest = {
  type: "auth";
  editSecret?: string | null;
};

export type AuthOk = {
  type: "auth-ok";
  role: ConnectionRole;
  language: string;
  online: number;
};

export type ControlError = {
  type: "error";
  code: string;
  message: string;
};

export type PresenceMessage = {
  type: "presence";
  online: number;
};

export type SavedMessage = {
  type: "saved";
};

export type ControlMessage = AuthRequest | AuthOk | ControlError | PresenceMessage | SavedMessage;
