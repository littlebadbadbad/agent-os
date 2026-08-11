/**
 * internal-apps/user-input/agent/askUser.ts — ask_user tool definition
 *
 * The core tool that agents call to request structured input from the user.
 * Supports 5 prompt types. The answer always binds to the tool call as a
 * tool result — never sent as a user message.
 *
 * Detailed usage rules live in the ToolSet's `onGetSystemPrompt`, not here.
 */

import { z } from "zod";
import { defineTool, type UserInputRequest } from "@agent-type";

export const CANCEL_MSG =
  "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";

export const askUserSchema = z.object({
  type: z
    .enum(["text", "confirm", "select", "multiSelect", "number"])
    .describe(
      'Prompt type: "text" (free-form), "confirm" (yes/no), ' +
        '"select" (pick one), "multiSelect" (pick many), ' +
        '"number" (numeric).',
    ),
  question: z.string().min(1).describe("The question shown to the user."),
  placeholder: z
    .string()
    .optional()
    .describe("(text/number) Hint text before user types."),
  default_value: z
    .string()
    .optional()
    .describe("(text) Pre-filled text the user can accept or edit."),
  default_number: z
    .number()
    .optional()
    .describe("(number) Pre-filled numeric value."),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe("(select/multiSelect) Choices for the user (min 2 items)."),
  min_select: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("(multiSelect) Minimum selections required."),
  max_select: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("(multiSelect) Maximum selections allowed."),
  min: z.number().optional().describe("(number) Minimum allowed value."),
  max: z.number().optional().describe("(number) Maximum allowed value."),
  step: z.number().optional().describe("(number) Increment step."),
});

// ── Build a UserInputRequest from the Zod-parsed params ───────────────────────

export function toRequest(params: z.infer<typeof askUserSchema>): UserInputRequest {
  switch (params.type) {
    case "text":
      return {
        type: "text",
        message: params.question,
        placeholder: params.placeholder,
        defaultValue: params.default_value,
      };
    case "confirm":
      return { type: "confirm", message: params.question };
    case "multiSelect":
      return {
        type: "multiSelect",
        message: params.question,
        options: params.options ?? [],
        minSelect: params.min_select,
        maxSelect: params.max_select,
      };
    case "number":
      return {
        type: "number",
        message: params.question,
        placeholder: params.placeholder,
        defaultValue: params.default_number,
        min: params.min,
        max: params.max,
        step: params.step,
      };
    case "select":
      return {
        type: "select",
        message: params.question,
        options: params.options ?? [],
      };
  }
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const askUserTool = defineTool({
  name: "ask_user",
  description: "Ask the user for input. Suspend tool execution until the user responds.",
  parameters: askUserSchema,
  group: "interaction",
  execute: async (params, context) => {
    if (!context.requestUserInput) {
      return "[ask_user] requestUserInput is not available. The User Input extension may not be installed.";
    }

    // Validate select/multiSelect have enough options.
    if (
      (params.type === "select" || params.type === "multiSelect") &&
      (!params.options || params.options.length < 2)
    ) {
      return `[ask_user] type "${params.type}" requires at least 2 options. Please retry with a valid options array.`;
    }

    const request = toRequest(params);
    // Use the original LLM tool call ID so the persisted prompt entry's
    // toolCallId matches the assistant message in the conversation history.
    // Without this, the restore path would generate a random ID and fail
    // to correlate with the existing assistant message, causing duplicate
    // messages and API errors.
    const result = await context.requestUserInput(request, context.toolCallId);

    if (result === null) {
      return CANCEL_MSG;
    }

    // The answer always binds to the tool call — the LLM receives it as a
    // `tool` message result.
    return result;
  },
});
