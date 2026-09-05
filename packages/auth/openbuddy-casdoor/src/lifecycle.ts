export type CasdoorLifecycleKind =
  | "login"
  | "login-failed"
  | "refresh"
  | "logout"
  | "tenant-switch"
  | "session-invalidated"
  | "member-revoked"
  | "config-change"
  | "state-change";

export interface CasdoorLifecycleEvent {
  kind: CasdoorLifecycleKind;
  at: string;
  status: "signed_out" | "signed_in" | "configuration_needed" | "error";
  scope: string;
  previousScope: string;
  scopeChanged: boolean;
  tenantId?: string;
}
