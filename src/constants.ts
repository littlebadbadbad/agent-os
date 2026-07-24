// ── Summarization anchor markers ──────────────────────────────────────────────
//
// These constants define the wire format for conversation summarization anchors.
// The context compaction process writes summary anchor pairs (user prefix +
// assistant ack) into the message history.  The SDK's history converter must
// recognise these pairs to render them as compressed-context notices rather
// than raw messages.
//
// Keeping the values here ensures the SDK core has no runtime dependency on
// the optional extension.  The values MUST stay in sync with the extension's
// constant definitions.

/** Prefix that identifies a summary anchor message in the conversation history. */
export const SUMMARY_ANCHOR_PREFIX = '[Context summary]\n';

/** The fixed acknowledgement message that follows every summary anchor. */
export const SUMMARY_ANCHOR_ACK = 'Understood.';


