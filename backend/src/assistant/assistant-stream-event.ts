import type { AssistantReply } from './assistant-orchestrator.service';

/**
 * One line of the newline-delimited JSON stream POST /assistant/message
 * responds with. `tool` events are purely cosmetic (a live "doing X…"
 * status for the UI — see AssistantWidget); the stream always ends in
 * exactly one `final` or `error` event carrying the real result.
 */
export type AssistantStreamEvent =
  | { type: 'tool'; tool: string; phase: 'start' | 'end'; label: string }
  | ({ type: 'final' } & AssistantReply)
  | { type: 'error'; message: string };
