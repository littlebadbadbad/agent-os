// ═══════════════════════════════════════════════════════════════════════════════
//  Vendor-specific tool wire formats  (来自 src/tools/types/vendor.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/** OpenAI Chat Completions / Assistants API `tools[]` entry. */
export type OpenAIToolParam = {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly strict?: boolean;
  };
};

/** Anthropic Messages API `tools[]` entry. */
export type AnthropicToolParam = {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
};

/** Google Gemini `functionDeclarations[]` entry. */
export type GeminiFunctionDeclaration = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

// ── Vendor-specific message wire formats ──────────────────────────────────────

/** A single OpenAI content part (text or image). */
export type OpenAIContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image_url';
      readonly image_url: {
        readonly url: string;
        readonly detail?: 'auto' | 'low' | 'high';
      };
    };

/** OpenAI-format message (multimodal-aware). */
export type OpenAIMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly OpenAIContentPart[] }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly {
        readonly id: string;
        readonly type: 'function';
        readonly function: { readonly name: string; readonly arguments: string };
      }[];
    }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string | readonly OpenAIContentPart[] };

/** An Anthropic content block (text, image, document, or tool_use/tool_result). */
export type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image';
      readonly source:
        | { readonly type: 'base64'; readonly media_type: string; readonly data: string }
        | { readonly type: 'url'; readonly url: string };
    }
  | {
      readonly type: 'document';
      readonly source: { readonly type: 'base64'; readonly media_type: string; readonly data: string };
      readonly title?: string;
    }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | {
      readonly type: 'tool_result';
      readonly tool_use_id: string;
      readonly content: string | readonly AnthropicContentBlock[];
    };

/** Anthropic-format message (multimodal-aware). */
export type AnthropicMessage =
  | { readonly role: 'user'; readonly content: string | readonly AnthropicContentBlock[] }
  | { readonly role: 'assistant'; readonly content: string | readonly AnthropicContentBlock[] };

/** A single Google Gemini content part. */
export type GeminiPart =
  | { readonly text: string }
  | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
  | { readonly fileData: { readonly mimeType: string; readonly fileUri: string } }
  | { readonly functionCall: { readonly name: string; readonly args: Record<string, unknown> } }
  | {
      readonly functionResponse: {
        readonly name: string;
        readonly response: { readonly name: string; readonly content: unknown };
      };
    };

/** Google Gemini-format content entry. */
export type GeminiContent = {
  readonly role: 'user' | 'model';
  readonly parts: readonly GeminiPart[];
};
