import { QUESTION_LIMITS, type QuestionOption } from '@app/shared';
import { isRecord } from '../errors.js';
import { defineTool } from './define.js';

const { questionChars, minOptions, maxOptions, labelChars, descriptionChars } = QUESTION_LIMITS;

export const askUser = defineTool<{ question: string; options: unknown[] }>({
  name: 'ask_user',
  description: `Ask the user one question and wait for the answer, with ${minOptions} to ${maxOptions} options they pick from (they can also type their own answer, or skip). Use it when you need a decision only the user can make before going on: which of several approaches, names or versions to use, or whether to go ahead with a change. Don't end your reply with a question listing choices; ask with this instead. Don't ask what you can find out with your tools, and don't ask for permission to run a tool (tools that need it ask by themselves).`,
  properties: {
    question: {
      type: 'string',
      description: `The question, short and complete on its own (under ${questionChars} characters), e.g. "Which PR title should I use?"`,
    },
    options: {
      type: 'array',
      description: `${minOptions} to ${maxOptions} distinct answers, the one you recommend first.`,
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: `The answer itself, a few words (it is what you get back when picked).`,
          },
          description: {
            type: 'string',
            description: 'Optional: what picking it means, when the label alone does not say.',
          },
        },
        required: ['label'],
      },
    },
  },
  async run({ question, options }, ctx) {
    const text = question.trim();
    if (!text) throw new Error('Write the question.');
    if (text.length > questionChars) {
      throw new Error(`Keep the question under ${questionChars} characters.`);
    }
    const choices = readOptions(options);
    if (!ctx.askUser) {
      throw new Error(
        'Nobody can answer questions here. Ask in your reply instead, or go on with your best judgment and say what you assumed.',
      );
    }
    const answer = await ctx.askUser({ question: text, options: choices });
    if (answer.type === 'skipped') {
      return 'The user skipped the question. Go on with your best judgment and say what you assumed, or leave that part out and say so.';
    }
    const picked = choices.find((option) => option.label === answer.text);
    return picked
      ? `The user chose: ${picked.label}`
      : `The user answered in their own words: ${answer.text}`;
  },
});

/** The model's options, checked: each a label with an optional description, no repeats. */
function readOptions(raw: readonly unknown[]): QuestionOption[] {
  if (raw.length < minOptions || raw.length > maxOptions) {
    throw new Error(`Give ${minOptions} to ${maxOptions} options.`);
  }
  const options = raw.map((item, i) => {
    if (!isRecord(item) || typeof item.label !== 'string' || !item.label.trim()) {
      throw new Error(`Option ${i + 1} needs a label (a string).`);
    }
    const label = item.label.trim();
    if (label.length > labelChars) {
      throw new Error(`Keep option labels under ${labelChars} characters.`);
    }
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (description.length > descriptionChars) {
      throw new Error(`Keep option descriptions under ${descriptionChars} characters.`);
    }
    return description ? { label, description } : { label };
  });
  if (new Set(options.map((option) => option.label)).size !== options.length) {
    throw new Error('Give each option a different label.');
  }
  return options;
}
