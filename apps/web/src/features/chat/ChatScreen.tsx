import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppInfo, ChatSettings, ChatSummary, Workspace } from '@app/shared';
import { AppNav } from '../../layout/AppNav';
import { errorMessage, isNotFound } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useMediaQuery } from '../../lib/useMediaQuery';
import type { AsyncResource } from '../../lib/useAsync';
import { useStoredState } from '../../lib/useStoredState';
import { useFiles } from '../panel/files/useFiles';
import { useMemories } from '../panel/memory/useMemories';
import { SkillDialogProvider } from '../skills/SkillDialogProvider';
import { useSkills } from '../skills/useSkills';
import {
  parseCenterTab,
  parsePanelTab,
  visibleCenterTabs,
  type CenterTab,
  type PanelTab,
} from '../panel/panelTabs';
import { GitPanel } from '../panel/git/GitPanel';
import { useGitChangeCount } from '../panel/git/useGitChangeCount';
import { InstructionsPanel } from '../panel/instructions/InstructionsPanel';
import { NotesPanel } from '../panel/notes/NotesPanel';
import { useNotes } from '../panel/notes/useNotes';
import { TerminalPanel } from '../panel/terminal/TerminalPanel';
import { SidePanel } from '../panel/SidePanel';
import { usePanelWidth } from '../panel/usePanelWidth';
import { useWorkspace } from '../workspaces/useWorkspace';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';
import { rememberLastWorkspace } from '../workspaces/lastWorkspace';
import { improvePrompt, saveChatSettings } from './api';
import { ChatHeader } from './ChatHeader';
import { ChatSidebar } from './ChatSidebar';
import { ChatView } from './ChatView';
import { AutoApproveToggle } from './AutoApproveToggle';
import { ModelControls } from './ModelControls';
import { useChats } from './useChats';
import { onRunNews, useLiveRuns } from './liveRuns';
import { useConversation } from './useConversation';
import { useModelChoice } from './useModelChoice';
import { useSidebarWidth } from './useSidebarWidth';
import { APP_NAME } from '../../lib/brand';

const parseFlag = (stored: string | null) => stored === 'true';

/**
 * The chat screen for one workspace: the chats sidebar, the open chat, and the side panel
 * (plan, memory, files). `chatId` is null for a new chat. The workspace sidebar is ChatRoute's,
 * to its left, so it stays put while this screen is replaced by another workspace's.
 */
export function ChatScreen({
  workspaceId,
  chatId,
  info,
  workspaces,
}: {
  workspaceId: string;
  chatId: string | null;
  /**
   * Loaded once by ChatRoute, which outlives this screen (switching workspaces remounts it),
   * and shared with its workspace sidebar.
   */
  info: AsyncResource<AppInfo>;
  workspaces: AsyncResource<Workspace[]>;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const workspacePath = `/workspaces/${workspaceId}`;

  const workspace = useWorkspace(workspaceId);
  const chats = useChats(workspaceId);
  const memories = useMemories(workspaceId);
  const skills = useSkills(workspaceId);
  const files = useFiles(workspaceId);
  const { models, choice, chooseModel, chooseEffort } = useModelChoice();
  // Like the model, a choice for the messages from here on (shown in warning colours while on).
  const [autoApprove, setAutoApprove] = useStoredState('agent.autoApprove', parseFlag);

  const isWide = useMediaQuery('(min-width: 1024px)');
  const panelWidth = usePanelWidth();
  const sidebarWidth = useSidebarWidth();
  const [tab, setTab] = useStoredState<PanelTab>('agent.panelTab', parsePanelTab);
  const [centerTab, setCenterTab] = useStoredState<CenterTab>('agent.centerTab', parseCenterTab);
  const [isPanelCollapsed, setIsPanelCollapsed] = useStoredState('agent.panelCollapsed', parseFlag);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useStoredState(
    'agent.sidebarCollapsed',
    parseFlag,
  );
  const [isPanelDrawerOpen, setIsPanelDrawerOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const { upsert: upsertChat, remove: removeChat, reload: reloadChats } = chats;
  const { reload: reloadMemories } = memories;
  const { reload: reloadFiles } = files;
  const { reload: reloadWorkspaces } = workspaces;
  const { reload: reloadWorkspace } = workspace;

  // A workspace saved in the popup over this screen: show its new name, folder, instructions.
  useEffect(
    () =>
      onWorkspaceSaved(() => {
        reloadWorkspace();
        reloadWorkspaces();
      }),
    [reloadWorkspace, reloadWorkspaces],
  );

  const conversation = useConversation({
    workspaceId,
    chatId,
    onChat: (chat, isNew) => {
      if (isNew) navigate(`${workspacePath}/chats/${chat.id}`, { replace: true });
    },
    onLoaded: (detail) => {
      // Each chat brings back the settings it last used; one that never saved any keeps the
      // current ones (they become its own with its next message or change).
      if (detail.settings) {
        chooseModel(detail.settings.modelId ?? '');
        chooseEffort(detail.settings.reasoningEffort);
        setAutoApprove(detail.settings.autoApprove);
      }
      // A chat link from another workspace: show it where it belongs.
      if (detail.chat.workspaceId !== workspaceId) {
        navigate(`/workspaces/${detail.chat.workspaceId}/chats/${detail.chat.id}`, {
          replace: true,
        });
      }
    },
    onMessagesReturned: (reason) => toast(reason, 'warning'),
    onLoadError: (cause) => {
      if (isNotFound(cause)) {
        toast('That chat no longer exists.', 'warning');
        navigate(workspacePath, { replace: true });
      } else {
        toast(errorMessage(cause, "Couldn't open the chat."), 'error');
      }
    },
  });
  const { isBusy } = conversation;

  // Runs keep going while another workspace or chat is open (liveRuns): this screen follows
  // the ones in its workspace, and any run's end may change the workspace list.
  const liveRuns = useLiveRuns();
  const isWorkspaceBusy = liveRuns.some((run) => run.workspaceId === workspaceId);
  const runningChatIds = useMemo(
    () => new Set(liveRuns.flatMap((run) => (run.chatId ? [run.chatId] : []))),
    [liveRuns],
  );
  const runningWorkspaceIds = useMemo(
    () => new Set(liveRuns.map((run) => run.workspaceId)),
    [liveRuns],
  );
  useEffect(
    () =>
      onRunNews((news) => {
        if (news.type === 'end') reloadWorkspaces();
        if (news.workspaceId !== workspaceId) return;
        if (news.type === 'chat') {
          upsertChat({ ...news.chat, isRunning: true });
          return;
        }
        reloadChats();
        reloadMemories();
        reloadFiles();
      }),
    [workspaceId, upsertChat, reloadChats, reloadMemories, reloadFiles, reloadWorkspaces],
  );

  /**
   * A change in the composer's settings, saved with the open chat (a new chat saves them with
   * its first message). The choice also stays as the default for the next new chat.
   */
  const saveSettings = (changes: Partial<ChatSettings>) => {
    if (!chatId) return;
    const settings: ChatSettings = {
      modelId: choice.model?.id ?? null,
      reasoningEffort: choice.effort,
      autoApprove,
      ...changes,
    };
    saveChatSettings(chatId, settings).catch((cause: unknown) => {
      if (!isNotFound(cause)) {
        toast(errorMessage(cause, "Couldn't save this chat's settings."), 'error');
      }
    });
  };

  // Opened fine: this is the workspace to come back to on the next launch.
  const loadedWorkspaceId = workspace.data?.id;
  useEffect(() => {
    if (loadedWorkspaceId) rememberLastWorkspace(loadedWorkspaceId);
  }, [loadedWorkspaceId]);

  useEffect(() => {
    if (!isNotFound(workspace.error)) return;
    toast('That workspace no longer exists.', 'warning');
    navigate('/', { replace: true });
  }, [workspace.error, navigate, toast]);

  // On a small screen the drawers cover the chat, so opening another chat closes them.
  useEffect(() => {
    setIsSidebarOpen(false);
    setIsPanelDrawerOpen(false);
  }, [chatId]);

  const workspaceName = workspace.data?.name;
  const chatTitle = chats.data?.find((chat) => chat.id === chatId)?.title;
  useEffect(() => {
    document.title = workspaceName
      ? chatTitle
        ? `${chatTitle} · ${workspaceName}`
        : `${workspaceName} · ${APP_NAME}`
      : APP_NAME;
  }, [chatTitle, workspaceName]);

  // Terminal and Git diff (tabs beside the chat) each show only when the workspace turns them
  // on; a remembered one that's hidden here shows the chat instead (and comes back where it's on).
  const hasTerminalTab = workspace.data?.hasTerminalTab ?? false;
  const hasGitTab = workspace.data?.hasGitTab ?? false;
  const optionalTabs = useMemo(
    () => ({ terminal: hasTerminalTab, git: hasGitTab }),
    [hasTerminalTab, hasGitTab],
  );
  const centerTabs = visibleCenterTabs(optionalTabs);
  const shownCenterTab = centerTabs.includes(centerTab) ? centerTab : 'chat';
  const gitChanges = useGitChangeCount(workspaceId, hasGitTab, isWorkspaceBusy);
  // Loaded here so an open note's list survives switching tabs; reloaded when picked.
  const notes = useNotes(workspaceId);
  const { reload: reloadNotes } = notes;
  // The Instructions tab's unsaved text (null: unchanged), kept here so it survives tab switches.
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null);
  const selectCenterTab = (next: CenterTab) => {
    if (next === 'notes' && shownCenterTab !== 'notes') reloadNotes();
    setCenterTab(next);
  };

  const selectTab = (next: PanelTab) => {
    setTab(next);
    if (next === 'files') reloadFiles();
  };

  const isPanelShown = isWide ? !isPanelCollapsed : isPanelDrawerOpen;
  const togglePanel = () => {
    if (isWide) setIsPanelCollapsed(!isPanelCollapsed);
    else setIsPanelDrawerOpen((open) => !open);
  };

  const { reset } = conversation;
  const startNewChat = () => {
    setIsSidebarOpen(false);
    if (chatId) navigate(workspacePath);
    else reset();
  };

  const onRenamed = useCallback((chat: ChatSummary) => upsertChat(chat), [upsertChat]);
  const onDeleted = useCallback(
    (deletedId: string) => {
      removeChat(deletedId);
      reloadWorkspaces();
      if (deletedId === chatId) navigate(workspacePath, { replace: true });
    },
    [removeChat, reloadWorkspaces, chatId, navigate, workspacePath],
  );

  // Collapsed columns shrink to 0 (rather than being removed), so the change in width can
  // be animated (grid-template-columns transitions when the track count stays the same).
  const panelStyle = {
    '--panel-w': `${panelWidth.width}px`,
    '--panel-col': isPanelCollapsed ? '0px' : `${panelWidth.width}px`,
    '--sidebar-w': `${sidebarWidth.width}px`,
    '--sidebar-col': isSidebarCollapsed ? '0px' : `${sidebarWidth.width}px`,
  } as CSSProperties;
  const columns =
    'lg:grid-cols-[minmax(0,1fr)_var(--panel-col)] xl:grid-cols-[var(--sidebar-col)_minmax(0,1fr)_var(--panel-col)]';
  const workspaceList = workspaces.data ?? [];

  return (
    <SkillDialogProvider workspaceId={workspaceId} skills={skills}>
      <div className="flex h-full flex-col bg-bg">
        <AppNav
          workspace={workspace.data}
          workspaces={workspaceList}
          onOpenWorkspaces={reloadWorkspaces}
          info={info.data}
          infoError={info.error}
          runningWorkspaceIds={runningWorkspaceIds}
          hasSidebar
          chatsToggle={{
            isOpen: isSidebarOpen,
            onToggle: () => setIsSidebarOpen((open) => !open),
          }}
        />
        <div
          // One row; Preferences is at the bottom of the workspace sidebar (or the chats drawer).
          className={`panel-grid grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-300 lg:ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${columns}`}
          style={panelStyle}
        >
          <ChatSidebar
            isOpen={isSidebarOpen}
            isCollapsed={isSidebarCollapsed}
            onCollapse={() => setIsSidebarCollapsed(true)}
            onClose={() => setIsSidebarOpen(false)}
            width={sidebarWidth}
            workspaceId={workspaceId}
            workspace={workspace.data}
            workspaces={workspaceList}
            onOpenWorkspaces={reloadWorkspaces}
            info={info.data}
            infoError={info.error}
            chats={chats.data}
            chatsError={chats.error}
            activeChatId={chatId}
            runningChatIds={runningChatIds}
            runningWorkspaceIds={runningWorkspaceIds}
            onNewChat={startNewChat}
            onRenamed={onRenamed}
            onDeleted={onDeleted}
          />
          <div className="flex min-h-0 min-w-0 flex-col bg-surface">
            <ChatHeader
              title={chatId ? (chatTitle ?? 'Chat') : 'New chat'}
              isBusy={isBusy}
              tabs={centerTabs}
              tab={shownCenterTab}
              onTab={selectCenterTab}
              gitChanges={gitChanges}
              isPanelShown={isPanelShown}
              onTogglePanel={togglePanel}
              onShowSidebar={isSidebarCollapsed ? () => setIsSidebarCollapsed(false) : undefined}
            />
            {shownCenterTab !== 'chat' && (
              <div
                id="center-body"
                role="tabpanel"
                aria-labelledby={`center-tab-${shownCenterTab}`}
                data-panel-body
                // Keyed by tab, so each tab's content fades in when it's picked.
                key={shownCenterTab}
                className={`min-h-0 flex-1 animate-fade-in bg-surface ${
                  shownCenterTab === 'terminal' ? 'overflow-hidden' : 'overflow-y-auto'
                }`}
              >
                {shownCenterTab === 'terminal' && <TerminalPanel workspaceId={workspaceId} />}
                {shownCenterTab === 'git' && (
                  <GitPanel workspaceId={workspaceId} isBusy={isWorkspaceBusy} />
                )}
                {shownCenterTab === 'instructions' && (
                  <InstructionsPanel
                    workspaceId={workspaceId}
                    workspace={workspace.data}
                    isLoading={workspace.isLoading}
                    error={workspace.error}
                    onRetry={reloadWorkspace}
                    draft={instructionsDraft}
                    onDraftChange={setInstructionsDraft}
                  />
                )}
                {shownCenterTab === 'notes' && (
                  <NotesPanel workspaceId={workspaceId} notes={notes} />
                )}
              </div>
            )}
            {/* Kept mounted (just hidden) behind the other tabs, so a draft and the scroll stay put. */}
            <div
              id={shownCenterTab === 'chat' ? 'center-body' : undefined}
              role="tabpanel"
              aria-labelledby="center-tab-chat"
              hidden={shownCenterTab !== 'chat'}
              className={`min-h-0 min-w-0 flex-1 flex-col ${shownCenterTab === 'chat' ? 'flex' : 'hidden'}`}
            >
              <ChatView
                workspaceId={workspaceId}
                chatKey={chatId ?? 'new'}
                state={conversation.state}
                workspace={workspace.data}
                showWorkspaceName={
                  workspaceList.length > 1 ||
                  (workspaceName !== undefined && workspaceName !== 'Default')
                }
                isBusy={isBusy}
                isLoading={conversation.isLoading}
                isRunningElsewhere={conversation.isRunningElsewhere}
                hasModel={choice.model !== null}
                modelControls={
                  <div className="flex min-w-0 items-center gap-0.5">
                    <ModelControls
                      models={models.data}
                      choice={choice}
                      disabled={isBusy}
                      onChooseModel={(id) => {
                        chooseModel(id);
                        saveSettings({ modelId: id });
                      }}
                      onChooseEffort={(effort) => {
                        chooseEffort(effort);
                        saveSettings({ reasoningEffort: effort });
                      }}
                    />
                    {/* Only when the agent asks first (Settings → Agent: approvals "ask"). */}
                    {info.data?.approval === 'ask' && (
                      <AutoApproveToggle
                        isOn={autoApprove}
                        onChange={(isOn) => {
                          setAutoApprove(isOn);
                          saveSettings({ autoApprove: isOn });
                          conversation
                            .changeAutoApprove(isOn)
                            .catch((cause: unknown) =>
                              toast(errorMessage(cause, "Couldn't change Auto-approve."), 'error'),
                            );
                        }}
                      />
                    )}
                  </div>
                }
                onSend={(text, attachments) =>
                  void conversation.send(text, {
                    attachments,
                    autoApprove: info.data?.approval === 'ask' && autoApprove,
                    modelId: choice.model?.id,
                    reasoningEffort:
                      (choice.model?.supportsReasoning && choice.effort) || undefined,
                  })
                }
                onSteer={(text) => void conversation.steer(text)}
                queued={conversation.queued}
                restoreDraft={conversation.returned}
                onImprove={(text) =>
                  improvePrompt({
                    text,
                    workspaceId,
                    modelId: choice.model?.id,
                    reasoningEffort:
                      (choice.model?.supportsReasoning && choice.effort) || undefined,
                  })
                }
                onStop={() => void conversation.stop()}
                isStopping={conversation.isStopping}
                onDecide={(approvalId, allow) => void conversation.decide(approvalId, allow)}
                onAnswer={(questionId, answer) => void conversation.answer(questionId, answer)}
                onReload={() => {
                  conversation.reload();
                  reloadChats();
                }}
                onEditInstructions={() => selectCenterTab('instructions')}
              />
            </div>
          </div>
          <SidePanel
            tab={tab}
            onTab={selectTab}
            workspaceId={workspaceId}
            memories={memories}
            skills={skills}
            files={files}
            width={panelWidth}
            isDrawerOpen={isPanelDrawerOpen}
            isCollapsed={isPanelCollapsed}
            isBusy={isWorkspaceBusy}
            onCloseDrawer={() => setIsPanelDrawerOpen(false)}
            onHide={togglePanel}
          />
        </div>
      </div>
    </SkillDialogProvider>
  );
}
