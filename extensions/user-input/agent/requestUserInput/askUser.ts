/**
 * extensions/user-input/agent/askUser.ts — ask_user tool definition
 *
 * The core tool that agents call to request structured input from the user.
 * Supports 5 prompt types: text, confirm, select, multiSelect, number.
 *
 * Ported from plugins/user-input/index.js with full TypeScript typing.
 */

import { z } from "zod";
import { defineTool } from "@agent-type";

const askUserSchema = z.object({
  type: z
    .enum(["text", "confirm", "select", "multiSelect", "number"])
    .describe(
      'Prompt type: "text" (free-form), "confirm" (yes/no → returns "yes"), ' +
        '"select" (pick one), "multiSelect" (pick many → JSON array string), ' +
        '"number" (numeric → string).',
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

const DESCRIPTION = `Ask the user for input. Suspend tool execution until the user responds. Never guess or assume missing required information — always use this tool.`;

export const askUserTool = defineTool({
  name: "ask_user",
  description: DESCRIPTION,
  parameters: askUserSchema,
  group: "interaction",
  execute: async (params, context) => {
    if (!context.requestUserInput) {
      return '[ask_user] requestUserInput is not available. The User Input extension may not be installed.';
    }

    const abortSignal = context.signal;

    if (params.type === "text") {
      const result = await context.requestUserInput(
        {
          type: "text",
          message: params.question,
          placeholder: params.placeholder,
          defaultValue: params.default_value,
        },
        undefined,
      );
      if (result === null) {
        return "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";
      }
      return result;
    }

    if (params.type === "confirm") {
      const result = await context.requestUserInput(
        {
          type: "confirm",
          message: params.question,
        },
        undefined,
      );
      if (result === null) {
        return "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";
      }
      return result;
    }

    if (params.type === "multiSelect") {
      const options = params.options;
      if (!options || options.length < 2) {
        return '[ask_user] type "multiSelect" requires at least 2 options. Please retry with a valid options array.';
      }
      const result = await context.requestUserInput(
        {
          type: "multiSelect",
          message: params.question,
          options,
          minSelect: params.min_select,
          maxSelect: params.max_select,
        },
        undefined,
      );
      if (result === null) {
        return "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";
      }
      return result;
    }

    if (params.type === "number") {
      const result = await context.requestUserInput(
        {
          type: "number",
          message: params.question,
          placeholder: params.placeholder,
          defaultValue: params.default_number,
          min: params.min,
          max: params.max,
          step: params.step,
        },
        undefined,
      );
      if (result === null) {
        return "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";
      }
      return result;
    }

    // "select"
    {
      const options = params.options;
      if (!options || options.length < 2) {
        return '[ask_user] type "select" requires at least 2 options. Please retry with a valid options array.';
      }
      const result = await context.requestUserInput(
        {
          type: "select",
          message: params.question,
          options,
        },
        undefined,
      );
      if (result === null) {
        return "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";
      }
      return result;
    }
  },
});
