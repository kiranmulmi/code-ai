import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  Attachment,
  ChatDetail,
  ChatSummary,
  QuestionAnswer,
  ReasoningEffort,
} from '@app/shared';
import { errorMessage, isNotFound } from '../../lib/api';
import {
  answerQuestion,
  decideApproval,
  fetchChat,
  setRunAutoApprove,
  steerRun,
  stopRun as requestStop,
} from './api';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
  type ConversationState,
} from './conversation';
import {
  attachToRun,
  dispatchToRun,
  hasRunFor,
  isLive,
  queueOf,
  startLiveRun,
  takeReturned,
  updateQueue,
  useLiveRuns,
  wasRead,
  type QueuedMessage,
} from './liveRuns';

export type { QueuedMessage } from './liveRuns';

type Options = {
  workspaceId: string;
  /** The chat in the URL, or null for a new chat. */
  chatId: string | null;
  /** The shown run's first event: the chat the message went to. `isNew` when it was just made. */
  onChat: (chat: ChatSummary, isNew: boolean) => void;
  onLoaded: (detail: ChatDetail) => void;
  onLoadError: (cause: unknown) => void;
  /** Messages sent during a run came back to the message box unread; `reason` says why. */
  onMessagesReturned: (reason: string) => void;
};

/** Text going back into the message box; a new `key` each time. */
export type ReturnedDraft = { text: string; key: number };

/** Which model a message goes to; left out, the server uses its default model. */
export type SendOptions = {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  /** Uploaded already (useDraftAttachments); sent as their ids. */
  attachments?: Attachment[];
  /** Run tools without asking (the composer's Auto-approve). */
  autoApprove?: boolean;
  /** Skills picked for this message, by name. */
  skills?: string[];
  /** Sent from voice mode: the agent writes what is to be read aloud in `<spoken>` blocks. */
  voice?: boolean;
};

/**
 * The open chat: loads its history when the URL changes, and sends messages through
 * `POST /v1/runs`. The run itself lives in `liveRuns`, so it keeps streaming when the user
 * opens another chat or workspace; this hook shows it while its chat is the open one.
 */
export function useConversation(options: Options) {
  const { workspaceId, chatId } = options;
  // The chat as loaded (or as its last run here ended); a live run's own state wins over it.
  const [loaded, setLoaded] = useState<ConversationState>(initialConversation);
  const dispatchLoaded = useCallback(
    (action: ConversationAction) => setLoaded((state) => conversationReducer(state, action)),
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRunningElsewhere, setIsRunningElsewhere] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [returned, setReturned] = useState<ReturnedDraft | null>(null);
  const callbacks = useRef(options);

  useEffect(() => {
    callbacks.current = options;
  });

  // This tab's run for the open chat (a new chat's, until the stream names its chat).
  const runs = useLiveRuns();
  const run = runs.find((item) => item.workspaceId === workspaceId && item.chatId === chatId);
  const runKey = run?.key ?? null;
  const runChatId = run?.chatId ?? null;
  const isBusy = run !== undefined;
  const state = run?.state ?? loaded;
  const queued = run?.queued ?? NO_QUEUE;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  /** Puts unread messages back in the message box, so nothing typed is lost. */
  const giveBack = useCallback((texts: string[], reason: string) => {
    if (!texts.length) return;
    setReturned((current) => ({ text: texts.join('\n\n'), key: (current?.key ?? 0) + 1 }));
    callbacks.current.onMessagesReturned(reason);
  }, []);

  // While its chat is open, the run tells this view about its chat and end.
  useEffect(() => {
    if (runKey === null) return;
    return attachToRun(runKey, {
      onChat: (chat, isNew) => callbacks.current.onChat(chat, isNew),
      onEnd: (final) => {
        // Commit the final state before the run leaves the live-runs store: that store's change
        // renders synchronously (useSyncExternalStore), ahead of a plain setState, so without
        // this one render shows `loaded` from before the run (the previous answer as the last
        // turn), which flickers the log and made voice mode read the previous reply aloud.
        flushSync(() => {
          setLoaded(final);
          setIsRunningElsewhere(false);
        });
      },
      onMessagesReturned: giveBack,
    });
  }, [runKey, giveBack]);

  useEffect(() => {
    setIsRunningElsewhere(false);
    // The live run owns this view, including the moment a new chat gets its id (and coming
    // back to a chat whose run kept going while another one was open).
    if (isBusyRef.current) {
      setIsLoading(false);
      return;
    }

    if (!chatId) {
      setLoaded(initialConversation);
      setIsLoading(false);
      return;
    }
    // Messages a run gave back while this chat was closed.
    const unread = takeReturned(chatId);
    if (unread.length) {
      giveBack(
        unread,
        "The agent finished before it read your last messages, so they're back in the message box.",
      );
    }

    let isCurrent = true;
    setIsLoading(true);
    fetchChat(chatId)
      .then((detail) => {
        // This tab's own run shows the chat; the saved copy is behind it.
        if (!isCurrent || hasRunFor(workspaceId, chatId)) return;
        setLoaded(conversationReducer(initialConversation, { type: 'load', detail }));
        setIsRunningElsewhere(detail.chat.isRunning);
        callbacks.current.onLoaded(detail);
      })
      .catch((cause: unknown) => {
        if (isCurrent) callbacks.current.onLoadError(cause);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, chatId, reloadToken, giveBack]);

  const send = useCallback(
    async (
      text: string,
      {
        modelId,
        reasoningEffort,
        attachments = [],
        autoApprove,
        skills = [],
        voice,
      }: SendOptions = {},
    ) => {
      const message = text.trim();
      if ((!message && !attachments.length) || isBusyRef.current) return;
      setIsRunningElsewhere(false);
      const shown = conversationReducer(loaded, {
        type: 'send',
        text: message,
        attachments,
        skills,
        at: Date.now(),
      });
      startLiveRun(
        {
          workspaceId,
          chatId: chatId ?? undefined,
          message,
          attachmentIds: attachments.length ? attachments.map((a) => a.id) : undefined,
          modelId,
          reasoningEffort,
          autoApprove: autoApprove || undefined,
          skills: skills.length ? skills : undefined,
          voice: voice || undefined,
        },
        shown,
      );
    },
    [workspaceId, chatId, loaded],
  );

  /**
   * Sends a message to the open chat's run in progress: it waits (shown in `queued`) until the
   * agent reads it before its next step. One the run can't take goes back to the message box.
   */
  const steer = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || runKey === null) return;
      if (!runChatId) {
        giveBack([message], 'The chat is still starting. Send it again in a moment.');
        return;
      }
      const key = nextQueueKey++;
      updateQueue(runKey, (list) => [...list, { key, id: null, text: message }]);
      const isWaiting = () => queueOf(runKey).some((item) => item.key === key);
      try {
        const { id } = await steerRun(runChatId, message);
        if (!isWaiting()) return; // the run ended meanwhile and gave it back
        updateQueue(runKey, (list) =>
          wasRead(runKey, id)
            ? list.filter((item) => item.key !== key)
            : list.map((item) => (item.key === key ? { ...item, id } : item)),
        );
      } catch (cause) {
        if (!isWaiting()) return;
        updateQueue(runKey, (list) => list.filter((item) => item.key !== key));
        giveBack(
          [message],
          isNotFound(cause)
            ? 'The agent had already finished, so your message is back in the message box.'
            : errorMessage(cause),
        );
      }
    },
    [runKey, runChatId, giveBack],
  );

  /** Applies a change to whatever the view shows: the live run, or the loaded chat. */
  const dispatch = useCallback(
    (action: ConversationAction) => {
      if (runKey !== null && isLive(runKey)) dispatchToRun(runKey, action);
      else dispatchLoaded(action);
    },
    [runKey, dispatchLoaded],
  );

  const decide = useCallback(
    async (approvalId: string, allow: boolean) => {
      dispatch({ type: 'approval_sending', approvalId });
      try {
        const { allowed } = await decideApproval(approvalId, allow);
        dispatch({ type: 'approval_decided', approvalId, allowed });
      } catch (cause) {
        dispatch({ type: 'approval_failed', approvalId, message: errorMessage(cause) });
      }
    },
    [dispatch],
  );

  /** Answers the question the agent is waiting on; it closes when the stream says so. */
  const answer = useCallback(
    async (questionId: string, reply: QuestionAnswer) => {
      dispatch({ type: 'question_sending', questionId });
      try {
        await answerQuestion(questionId, reply);
        dispatch({ type: 'question_answered', questionId });
      } catch (cause) {
        dispatch({ type: 'question_failed', questionId, message: errorMessage(cause) });
      }
    },
    [dispatch],
  );

  /**
   * Applies an Auto-approve change to the chat's run in progress (this tab's, or one running
   * elsewhere), from its next approval on. Nothing to do when none is running.
   */
  const changeAutoApprove = useCallback(
    async (autoApprove: boolean) => {
      const target = runChatId ?? (isRunningElsewhere ? chatId : null);
      if (!target) return;
      try {
        await setRunAutoApprove(target, autoApprove);
      } catch (cause) {
        if (!isNotFound(cause)) throw cause; // it finished meanwhile: the next message uses it
      }
    },
    [runChatId, chatId, isRunningElsewhere],
  );

  /** Clears the view for a new chat (when the URL is already the new-chat one). */
  const reset = useCallback(() => {
    if (!isBusyRef.current) setLoaded(initialConversation);
  }, []);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  /**
   * Asks the server to stop the run (this tab's, or one running elsewhere). The stream keeps
   * going until the agent has stopped and saved what it did, then ends as `stopped`.
   */
  const [isStopping, setIsStopping] = useState(false);
  const stop = useCallback(async () => {
    const target = runChatId ?? chatId;
    if (!target) return;
    const isOurs = runKey !== null;
    setIsStopping(true);
    dispatch({ type: 'stopping' });
    try {
      await requestStop(target);
    } catch {
      // Already finished: nothing to stop.
    } finally {
      setIsStopping(false);
      // Stopped from here while it ran in another tab: show what it saved once it's done.
      if (!isOurs) window.setTimeout(reload, 1200);
    }
  }, [runChatId, runKey, chatId, dispatch, reload]);

  return {
    state,
    isBusy,
    isLoading,
    isRunningElsewhere,
    isStopping,
    send,
    steer,
    queued,
    returned,
    stop,
    decide,
    answer,
    changeAutoApprove,
    reset,
    reload,
  };
}

const NO_QUEUE: QueuedMessage[] = [];
/** Keys for queued messages, unique across runs. */
let nextQueueKey = 1;
