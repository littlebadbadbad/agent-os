/**
 * internal-plugins/user-input/ui/prompts/types.ts — Shared props for prompt sub-components
 */

import type { InlinePromptEntry } from "../types";
import type { PromptInputState } from "../types";

export interface PromptComponentProps {
  readonly prompt: InlinePromptEntry;
  readonly onRespond: (value: string | null) => void;
  /** Per-prompt input state, restored from the navigation Map. */
  readonly inputState: PromptInputState;
  /** Called when input state changes (text input, checkbox toggle, etc.). */
  readonly onInputStateChange: (state: PromptInputState) => void;
}
