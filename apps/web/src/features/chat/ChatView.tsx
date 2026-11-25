import { useMemo, useState, type ReactNode } from 'react';
import type { Attachment, QuestionAnswer, Workspace } from '@app/shared';
import { PageLoader } from '../../components/PageLoader';
import { AgentMessage } from './AgentMessage';
import { PlanDock } from './PlanDock';
import { QuestionPrompt } from './QuestionPrompt';
import { placePlans } from './planPlacement';
import { Composer } from './Composer';
import type { ConversationState } from './conversation';
import type { QueuedMessage, ReturnedDraft } from './useConversation';
import { EmptyState } from './EmptyState';
import { RunningElsewhereNotice } from './RunningElsewhereNotice';
import { useStickToBottom } from './useStickToBottom';
import { UserMessage } from './UserMessage';
import { TokenUsageDialog, type UsageView } from './TokenUsageDialog';
import { messageUsages } from './tokenUsage';

/** The middle column: the conversation and the message box. */
export function ChatView({
  workspaceId,
  chatKey,
  state,
  workspace,
  showWorkspaceName,
  isBusy,
  isLoading,
  isRunningElsewhere,
  hasModel,
  modelControls,
  onSend,
  onSteer,
  queued,
  restoreDraft,
  onImprove,
  onStop,
  isStopping,
  onDecide,
  onAnswer,
  onReload,
  onEditInstructions,
}: {
  /** From the URL, so files can be attached before the workspace has loaded. */
  workspaceId: string;
  chatKey: string;
  state: ConversationState;
  workspace: Workspace | null;
  showWorkspaceName: boolean;
  isBusy: boolean;
  isLoading: boolean;
  isRunningElsewhere: boolean;
  hasModel: boolean;
  /** The composer's model and reasoning effort pickers. */
  modelControls: ReactNode;
  onSend: (text: string, attachments: Attachment[]) => void;
  /** Sends a message to this tab's run in progress, read before its next step. */
  onSteer: (text: string) => void;
  /** Messages sent during the run that the agent hasn't read yet. */
  queued: QueuedMessage[];
  /** A message that came back unread, for the message box. */
  restoreDraft: ReturnedDraft | null;
  /** Rewrites a draft prompt (the composer's improve button). */
  onImprove: (text: string) => Promise<string>;
  onStop: () => void;
  isStopping: boolean;
  onDecide: (approvalId: string, allow: boolean) => void;
  /** Answers the question the agent is waiting on (shown over the message box). */
  onAnswer: (questionId: string, answer: QuestionAnswer) => void;
  onReload: () => void;
  /** Opens the Instructions tab (from the new chat's instructions card). */
  onEditInstructions: () => void;
}) {
  const log = useStickToBottom<HTMLDivElement>(state.turns, chatKey);
  const plans = useMemo(() => placePlans(state.turns, state.plan), [state.turns, state.plan]);
  const [usageView, setUsageView] = useState<UsageView | null>(null);
  const usageRows = useMemo(() => messageUsages(state.turns), [state.turns]);
  const isEmpty = state.turns.length === 0;
  const canSend = !isBusy && !isRunningElsewhere && !isLoading;
  // While this tab's run works, the box stays open: what's sent goes to the agent mid-run.
  const canSteer = isBusy && !isLoading;
  const lastTurn = state.turns.at(-1);

  const send = (text: string, attachments: Attachment[]) => {
    log.pin();
    onSend(text, attachments);
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-bg)]">
      <div
        ref={log.ref}
        onScroll={log.onScroll}
        aria-live="polite"
        className={`min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 ${
          !isLoading && isEmpty ? 'dot-grid' : ''
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
          {isLoading && isEmpty && <PageLoader label="Opening chat…" />}
          {!isLoading && isEmpty && (
            <EmptyState
              workspace={workspace}
              showWorkspaceName={showWorkspaceName}
              onEditInstructions={onEditInstructions}
            />
          )}
          {state.turns.map((turn) =>
            turn.role === 'user' ? (
              <UserMessage
                key={turn.key}
                text={turn.text}
                attachments={turn.attachments}
                skills={turn.skills}
                sentAt={turn.sentAt}
                isSteer={turn.isSteer}
                workspaceId={workspaceId}
              />
            ) : (
              <AgentMessage
                key={turn.key}
                turn={turn}
                plans={plans}
                onDecide={onDecide}
                onShowUsage={() => setUsageView({ kind: 'reply', key: turn.key })}
                runStartedAt={turn === lastTurn ? state.runStartedAt : null}
              />
            ),
          )}
          {isRunningElsewhere && !isBusy && (
            <RunningElsewhereNotice onReload={onReload} onStop={onStop} isStopping={isStopping} />
          )}
        </div>
      </div>
      <PlanDock state={state.plan} />
      {queued.length > 0 && (
        <ul
          aria-label="Messages waiting for the agent"
          className="mx-auto flex w-full max-w-[1000px] flex-col items-end gap-1 px-4 pb-1 sm:px-6"
        >
          {queued.map((message) => (
            <li
              key={message.key}
              title={message.text}
              className="flex max-w-[92%] animate-slide-in-right items-center gap-1.5 rounded-xl border border-dashed border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 md:max-w-[80%]"
            >
              <span className="shrink-0 text-ink-3">Waiting for the next step:</span>
              <span className="min-w-0 truncate">{message.text}</span>
            </li>
          ))}
        </ul>
      )}
      {state.question && (
        <QuestionPrompt key={state.question.id} question={state.question} onAnswer={onAnswer} />
      )}
      <Composer
        workspaceId={workspaceId}
        disabled={!canSend && !canSteer}
        hasModel={hasModel}
        controls={modelControls}
        focusKey={chatKey}
        usage={state.usage}
        context={state.context}
        onShowUsage={() => setUsageView({ kind: 'chat' })}
        onSend={send}
        onImprove={onImprove}
        isRunning={isBusy}
        isStopping={isStopping}
        onStop={onStop}
        onSteer={onSteer}
        restoreDraft={restoreDraft}
      />
      {usageView && (
        <TokenUsageDialog rows={usageRows} view={usageView} onClose={() => setUsageView(null)} />
      )}
    </main>
  );
}
