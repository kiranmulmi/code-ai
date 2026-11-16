import { z } from 'zod';
import { QUESTION_LIMITS } from './constants.js';

export interface QuestionOption {
  /** What the answer is when picked: short, and the text the agent gets back. */
  label: string;
  /** What picking it means, when the label alone doesn't say. */
  description?: string;
}

/** A question the agent asks mid-run (ask_user), with options to pick from. */
export interface UserQuestion {
  question: string;
  options: QuestionOption[];
}

/** How the user answered: an option's label or their own words, or they skipped it. */
export type QuestionAnswer = { type: 'answered'; text: string } | { type: 'skipped' };

/** `POST /v1/questions/:questionId`: the user's answer. */
export const questionAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('answered'),
    text: z
      .string()
      .trim()
      .min(1, 'Type an answer, or skip the question.')
      .max(
        QUESTION_LIMITS.answerChars,
        `Keep the answer under ${QUESTION_LIMITS.answerChars} characters.`,
      ),
  }),
  z.object({ type: z.literal('skipped') }),
]);
