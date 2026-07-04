import { z } from "zod";
import { defineTool } from '@agent-type/defineTool';
import type { Tool } from '@agent-type';

const askUserSchema = z.object({
  type: z
    .enum(["text", "confirm", "select", "multiSelect", "number"])
    .describe(
      '"text" — free-form answer; ' +
        '"confirm" — yes/no question (returns "yes" or cancelled); ' +
        '"select" — pick one option from a fixed list; ' +
        '"multiSelect" — pick one or more options (returns JSON array string); ' +
        '"number" — numeric input (returns number as string).',
    ),
  question: z
    .string()
    .min(1)
    .describe("The question or prompt shown to the user."),
  placeholder: z
    .string()
    .optional()
    .describe(
      "(text/number only) Hint shown inside the input field before the user types.",
    ),
  default_value: z
    .string()
    .optional()
    .describe("(text only) Pre-filled text the user can accept or edit."),
  default_number: z
    .number()
    .optional()
    .describe("(number only) Pre-filled numeric value."),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "(select/multiSelect only) The choices available to the user (minimum 2 items required).",
    ),
  min_select: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("(multiSelect only) Minimum number of selections required."),
  max_select: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("(multiSelect only) Maximum number of selections allowed."),
  min: z
    .number()
    .optional()
    .describe("(number only) Minimum allowed value."),
  max: z
    .number()
    .optional()
    .describe("(number only) Maximum allowed value."),
  step: z
    .number()
    .optional()
    .describe("(number only) Increment step for the number input."),
});

export const askUserTool = defineTool({
  name: "ask_user",
  description:
    "ALWAYS call this tool to collect a required piece of information from the user " +
    "before taking any action that depends on it. " +
    "NEVER guess, assume, or proceed without asking when any of the following is true:\n" +
    "• The user's intent is ambiguous and the wrong choice would be hard to undo " +
    "(e.g. deleting files, overwriting content, choosing a target environment).\n" +
    "• A required parameter is missing and no default is reasonable.\n" +
    "• The task has two or more equally valid interpretations.\n" +
    "• You need explicit confirmation before a destructive or irreversible operation.\n" +
    'Use type "confirm" for yes/no decisions, "select" to present a fixed set of options, ' +
    '"multiSelect" when multiple choices are allowed, "number" for numeric input, ' +
    'and "text" to collect a free-form answer. ' +
    'Prefer "select" or "multiSelect" over "text" whenever the valid answers are known in advance.',
  parameters: askUserSchema,
  group: "interaction",
  execute: async (params, context) => {
    let result: string | null;

    if (params.type === "text") {
      result = await context.requestUserInput({
        type: "text",
        message: params.question,
        placeholder: params.placeholder,
        defaultValue: params.default_value,
      });
    } else if (params.type === "confirm") {
      result = await context.requestUserInput({
        type: "confirm",
        message: params.question,
      });
    } else if (params.type === "multiSelect") {
      const options = params.options;
      if (!options || options.length < 2) {
        return '[ask_user] type "multiSelect" requires at least 2 options. Please retry with a valid options array.';
      }
      result = await context.requestUserInput({
        type: "multiSelect",
        message: params.question,
        options,
        minSelect: params.min_select,
        maxSelect: params.max_select,
      });
    } else if (params.type === "number") {
      result = await context.requestUserInput({
        type: "number",
        message: params.question,
        placeholder: params.placeholder,
        defaultValue: params.default_number,
        min: params.min,
        max: params.max,
        step: params.step,
      });
    } else {
      const options = params.options;
      if (!options || options.length < 2) {
        return '[ask_user] type "select" requires at least 2 options. Please retry with a valid options array.';
      }
      result = await context.requestUserInput({
        type: "select",
        message: params.question,
        options,
      });
    }

    if (result === null) {
      return "[User cancelled — no input was provided. Proceed accordingly or try a different approach.]";
    }

    return result;
  },
});
