/**
 * CDP WebSocket message envelope schemas.
 *
 * Lightweight "shape checks" for the outer CDP message structure.
 * Validates the envelope (id/method/params/result/error) but does NOT
 * validate Chrome-internal field shapes — those are trusted.
 *
 * Used at JSON.parse boundaries in cdp-proxy.ts and replay-session.ts.
 */
import { Schema } from 'effect';

// ═══════════════════════════════════════════════════════════════════════
// CDP Message Envelopes
// ═══════════════════════════════════════════════════════════════════════

/** CDP command from client: { id, method, params?, sessionId? } */
export const CDPCommand = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.optionalKey(Schema.Any),
  sessionId: Schema.optionalKey(Schema.String),
});
export type CDPCommand = typeof CDPCommand.Type;

/** Any CDP message from browser (response or event). All fields optional
 *  because responses have id+result, events have method+params. */
export const CDPMessage = Schema.Struct({
  id: Schema.optionalKey(Schema.Number),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Any),
  result: Schema.optionalKey(Schema.Any),
  error: Schema.optionalKey(Schema.Any),
  sessionId: Schema.optionalKey(Schema.String),
});
export type CDPMessage = typeof CDPMessage.Type;

// ═══════════════════════════════════════════════════════════════════════
// Browserless Custom CDP Command Params
// ═══════════════════════════════════════════════════════════════════════

/** Params for Browserless.addReplayMarker */
export const AddReplayMarkerParams = Schema.Struct({
  targetId: Schema.optionalKey(Schema.String),
  tag: Schema.String,
  payload: Schema.optionalKey(Schema.Any),
});
export type AddReplayMarkerParams = typeof AddReplayMarkerParams.Type;

// ═══════════════════════════════════════════════════════════════════════
// rrweb Event Batch (from browser extension binding)
// ═══════════════════════════════════════════════════════════════════════

/** Single rrweb event — validates envelope, trusts data payload. */
const RrwebEvent = Schema.Struct({
  type: Schema.Number,
  timestamp: Schema.Number,
  data: Schema.optionalKey(Schema.Any),
});

/** Batch of rrweb events pushed via Runtime.addBinding. */
export const RrwebEventBatch = Schema.Array(RrwebEvent);
export type RrwebEventBatch = typeof RrwebEventBatch.Type;

// ═══════════════════════════════════════════════════════════════════════
// Pre-built decoders (avoid re-creating per message)
// ═══════════════════════════════════════════════════════════════════════

const _opts = { onExcessProperty: 'ignore' as const };
export const decodeCDPCommand = (u: unknown) => Schema.decodeUnknownExit(CDPCommand)(u, _opts);
export const decodeCDPMessage = (u: unknown) => Schema.decodeUnknownExit(CDPMessage)(u, _opts);
export const decodeAddReplayMarkerParams = (u: unknown) => Schema.decodeUnknownExit(AddReplayMarkerParams)(u, _opts);
export const decodeRrwebEventBatch = (u: unknown) => Schema.decodeUnknownExit(RrwebEventBatch)(u, _opts);
