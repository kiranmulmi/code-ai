// The reviewer: one tool-free model call that checks the agent's final answer before the user
// gets it. It sees only the request, the plan, what the agent found and the answer (not the
// conversation), so it judges the answer on the evidence rather than on the agent's reasoning.
import type { ReviewVerdict } from '@app/shared';
import { isRecord } from './errors.js';

export interface Review {
  verdict: ReviewVerdict;
  /** what to fix, one per item; empty on pass */
  issues: string[];
}

/** At most this many issues go back to the agent: the important ones. */
const MAX_ISSUES = 5;
const MAX_ISSUE_CHARS = 400;

export const REVIEW_PROMPT = `You review an AI agent's answer before the user sees it. You get the user's request, the agent's plan (if any), a log of what the agent did and found (tool calls and their results), and the agent's draft answer.

Be skeptical, but fair. Look for real problems only:
- claims the findings don't support, or that contradict them (made-up facts, numbers, links, file contents or results of commands that weren't run);
- parts of the request that the answer skips or gets wrong;
- saying work was done (a file changed, tests run, something checked) when the log doesn't show it;
- clear mistakes in code, steps or reasoning.

Don't ask for more polish, other wording or extra detail the user didn't ask for. Don't fault the answer for saying plainly what it couldn't do. If the answer is good enough for the request, pass it.

Reply with JSON only, no other text:
{"verdict": "pass" | "revise", "issues": ["one specific, actionable problem per item"]}
Use "revise" only with at least one issue, and at most ${MAX_ISSUES} issues.`;

/** The reviewer's one message: everything it judges, in one place. */
export function reviewMessage({
  request,
  plan,
  findings,
  answer,
}: {
  request: string;
  plan: string | null;
  findings: string;
  answer: string;
}): string {
  return [
    `<request>\n${request}\n</request>`,
    plan ? `<plan>\n${plan}\n</plan>` : null,
    `<findings>\n${findings || '(The agent used no tools for this request.)'}\n</findings>`,
    `<answer>\n${answer}\n</answer>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Read the reviewer's JSON reply. Anything unusable passes: a broken review never blocks. */
export function parseReview(text: string): Review {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { verdict: 'pass', issues: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { verdict: 'pass', issues: [] };
  }
  if (!isRecord(parsed)) return { verdict: 'pass', issues: [] };
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .filter((issue): issue is string => typeof issue === 'string' && issue.trim() !== '')
    .map((issue) => {
      const line = issue.trim();
      return line.length > MAX_ISSUE_CHARS ? `${line.slice(0, MAX_ISSUE_CHARS - 1)}…` : line;
    })
    .slice(0, MAX_ISSUES);
  return parsed.verdict === 'revise' && issues.length
    ? { verdict: 'revise', issues }
    : { verdict: 'pass', issues: [] };
}

/** What goes back to the agent when the reviewer wants changes. */
export function reviseMessage(issues: readonly string[]): string {
  return `[Automatic review by the agent framework, not a message from the user]
A reviewer checked your answer against what you found and raised these issues:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Fix what is right in them: check again with your tools where that helps. If an issue is wrong, ignore it; don't argue with the reviewer in your reply.

The user can already see your previous answer. When you're finished:
- If anything changed, give the complete corrected answer.
- If nothing needed changing, don't repeat your answer. Reply with one short sentence saying it stands.`;
}
