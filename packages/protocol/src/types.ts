export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface ModelIdentity { providerId: string; modelId: string; modelKey: string }
export interface ModelState extends ModelIdentity { sessionId: string; thinkingLevel: ThinkingLevel; availableThinkingLevels: ThinkingLevel[] }
export interface UiRequest { sessionId: string; requestId: string; kind: 'select' | 'confirm' | 'input' | 'editor'; title: string; options?: string[]; message?: string; placeholder?: string; initialValue?: string; timeoutMs?: number }
export interface UiResolution { sessionId: string; requestId: string; value?: string | boolean; cancelled?: boolean }
export interface AttachmentReference { path: string }
export type Payload = Record<string, unknown>;
export type CommandHandlers = Record<string, (payload: Payload) => unknown | Promise<unknown>>;
