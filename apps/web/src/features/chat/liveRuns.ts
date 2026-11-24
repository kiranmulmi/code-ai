// Runs this tab started, kept outside any screen: switching workspace or chat unmounts the chat
// screen, but the run's stream keeps being read here, so it never gets cut off.
import { useSyncExternalStore } from 'react';
import type { ChatSummary, RunRequest } from '@app/shared';
import { errorMessage } from '../../lib/api';
import { parseStreamEvent, readEventData } from '../../lib/sse';
import { startRun } from './api';
import {
  conversationReducer,
  type ConversationAction,
  type ConversationState,
} from './conversation';

/** A message sent while the agent works, shown until the agent reads it. */
export type QueuedMessage = {
  key: number;
  /** Null until the server accepts it. */
  id: string | null;
  text: string;
};

/**
 * The reply as it streams, for reading it aloud (voice mode): `text` pieces, and `break` when
 * something else happened (a tool call, an approval), so a sentence cut there is said as is.
 */
export type ReplyStreamEvent = { type: 'text'; text: string } | { type: 'break' };

/** One run in progress in this tab: its chat's conversation as it streams. */
export type LiveRun = {
  key: number;
  workspaceId: string;
  /** Null until the stream says which chat a new conversation went to. */
  chatId: string | null;
  state: ConversationState;
  /** Messages sent during the run that the agent hasn't read yet. */
  queued: QueuedMessage[];
};

/** What the chat screen showing the run wants to hear (only while it shows it). */
export type RunHandlers = {
  onChat: (chat: ChatSummary, isNew: boolean) => void;
  onReply: (event: ReplyStreamEvent) => void;
  /** The run ended; `state` is the conversation as it ended. */
  onEnd: (state: ConversationState) => void;
  onMessagesReturned: (texts: string[], reason: string) => void;
};

/** For every screen: a run's chat became known, or a run ended. */
export type RunNews =
  | { type: 'chat'; workspaceId: string; chat: ChatSummary }
  | { type: 'end'; workspaceId: string; chatId: string | null };

type Entry = {
  view: LiveRun;
  readIds: Set<string>;
  handlers: RunHandlers | null;
};

const entries = new Map<number, Entry>();
let snapshot: LiveRun[] = [];
let nextKey = 1;
const listeners = new Set<() => void>();
const newsListeners = new Set<(news: RunNews) => void>();
/** Messages a run gave back while its chat wasn't open, by chat id, until it is. */
const returnedByChat = new Map<string, string[]>();

function publish(): void {
  snapshot = [...entries.values()].map((entry) => entry.view);
  for (const listener of listeners) listener();
}

function tellNews(news: RunNews): void {
  for (const listener of newsListeners) listener(news);
}

function update(key: number, change: (view: LiveRun) => LiveRun): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.view = change(entry.view);
  publish();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;

/** Every run in progress in this tab. */
export function useLiveRuns(): LiveRun[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Hears every run's chat and end, whichever screen is open. Returns the unsubscribe. */
export function onRunNews(listener: (news: RunNews) => void): () => void {
  newsListeners.add(listener);
  return () => {
    newsListeners.delete(listener);
  };
}

export const isLive = (key: number): boolean => entries.has(key);

/** Whether this tab has a run going for the chat (a new chat's while its id is null). */
export const hasRunFor = (workspaceId: string, chatId: string | null): boolean =>
  snapshot.some((run) => run.workspaceId === workspaceId && run.chatId === chatId);

/** Applies a conversation change (an approval sent, Stopping…) to a run's state. */
export function dispatchToRun(key: number, action: ConversationAction): void {
  update(key, (view) => ({ ...view, state: conversationReducer(view.state, action) }));
}

export function updateQueue(key: number, change: (queued: QueuedMessage[]) => QueuedMessage[]) {
  update(key, (view) => ({ ...view, queued: change(view.queued) }));
}

export const queueOf = (key: number): QueuedMessage[] => entries.get(key)?.view.queued ?? [];

/** Whether the agent already read the message with this id (its `steer` event came first). */
export const wasRead = (key: number, id: string): boolean =>
  entries.get(key)?.readIds.has(id) ?? false;

/** The screen showing the run takes its news; returns the detach. */
export function attachToRun(key: number, handlers: RunHandlers): () => void {
  const entry = entries.get(key);
  if (!entry) return () => undefined;
  entry.handlers = handlers;
  return () => {
    if (entry.handlers === handlers) entry.handlers = null;
  };
}

/** Messages a run gave back while its chat was closed; taken once. */
export function takeReturned(chatId: string): string[] {
  const texts = returnedByChat.get(chatId) ?? [];
  returnedByChat.delete(chatId);
  return texts;
}

const RETURNED_REASON = (count: number) =>
  count === 1
    ? "The agent finished before it read your last message, so it's back in the message box."
    : "The agent finished before it read your last messages, so they're back in the message box.";

/**
 * Starts the agent on one message (`POST /v1/runs`) and folds its event stream into the run's
 * conversation, from `state` (the chat as shown, with the message already added). Returns the
 * run's key. The stream is read to its end whatever screen is open.
 */
export function startLiveRun(request: RunRequest, state: ConversationState): number {
  const key = nextKey++;
  const entry: Entry = {
    view: {
      key,
      workspaceId: request.workspaceId,
      chatId: request.chatId ?? null,
      state,
      queued: [],
    },
    readIds: new Set(),
    handlers: null,
  };
  entries.set(key, entry);
  publish();
  void stream(key, entry, request);
  return key;
}

async function stream(key: number, entry: Entry, request: RunRequest): Promise<void> {
  const dispatch = (action: ConversationAction) => dispatchToRun(key, action);
  // Text deltas are merged and applied at most once per frame.
  let pending = '';
  let frame = 0;
  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (pending) {
      dispatch({ type: 'event', event: { type: 'text_delta', text: pending }, at: Date.now() });
    }
    pending = '';
  };

  try {
    const body = await startRun(request, new AbortController().signal);
    for await (const data of readEventData(body)) {
      const event = parseStreamEvent(data);
      if (!event) continue;
      if (event.type === 'text_delta') {
        entry.handlers?.onReply({ type: 'text', text: event.text });
        pending += event.text;
        if (!frame) frame = requestAnimationFrame(flush);
        continue;
      }
      flush();
      entry.handlers?.onReply({ type: 'break' });
      if (event.type === 'chat') {
        const isNew = entry.view.chatId === null;
        // The screen showing it moves to the chat's URL in the same render as the run gets it.
        entry.handlers?.onChat(event.chat, isNew);
        update(key, (view) => ({ ...view, chatId: event.chat.id }));
        tellNews({ type: 'chat', workspaceId: entry.view.workspaceId, chat: event.chat });
        continue;
      }
      if (event.type === 'steer') {
        entry.readIds.add(event.id);
        updateQueue(key, (queued) => queued.filter((message) => message.id !== event.id));
      }
      dispatch({ type: 'event', event, at: Date.now() });
    }
    flush();
  } catch (cause) {
    flush();
    dispatch({ type: 'fail', message: errorMessage(cause) });
  } finally {
    if (frame) cancelAnimationFrame(frame);
    dispatch({ type: 'finish', at: Date.now() });
    const { view, handlers } = entry;
    const unread = view.queued.map((message) => message.text);
    entries.delete(key);
    handlers?.onEnd(view.state);
    if (unread.length) {
      if (handlers) handlers.onMessagesReturned(unread, RETURNED_REASON(unread.length));
      else if (view.chatId) {
        returnedByChat.set(view.chatId, [...(returnedByChat.get(view.chatId) ?? []), ...unread]);
      }
    }
    publish();
    tellNews({ type: 'end', workspaceId: view.workspaceId, chatId: view.chatId });
  }
}
