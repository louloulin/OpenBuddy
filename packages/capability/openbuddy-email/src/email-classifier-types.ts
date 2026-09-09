/**
 * email-classifier-types.ts — Email classifier input/output types.
 *
 * Phase H.1 — extracted to break a circular dep between
 * email-classifier.ts (which exports constants + helpers) and the
 * EmailActionCandidateInput / EmailActionCandidate types in index.ts.
 *
 * The types re-declared here mirror index.ts's `EmailActionCandidateInput`
 * and `EmailActionCandidate["source"]` literal. If index.ts ever changes
 * these types, run `pnpm typecheck` to catch the divergence — the field
 * shapes are intentionally minimal here because the classifier only
 * needs the LLM-action surface.
 */

export interface EmailActionCandidateInput {
  subject: string;
  body: string;
  messages: Array<{ id: string; from?: string; date?: string; text?: string; snippet?: string }>;
  phrases?: readonly string[];
  baseDate?: Date;
  now?: Date;
}

export type EmailActionCandidateSource =
  | "llm-phrase"
  | "heuristic-imperative"
  | "heuristic-deadline";

export interface EmailActionCandidate {
  content: string;
  owner?: string;
  dueAt?: string;
  messageId: string;
  citations: Array<{
    messageId: string;
    from?: string;
    date?: string;
    quote?: string;
  }>;
  confidence: number;
  source: EmailActionCandidateSource;
}