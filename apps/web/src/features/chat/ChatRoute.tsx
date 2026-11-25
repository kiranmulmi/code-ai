import { useMemo, type CSSProperties } from 'react';
import { Navigate, useMatch, useParams } from 'react-router-dom';
import { useStoredState } from '../../lib/useStoredState';
import { useWorkspaceGroups } from '../workspaces/useWorkspaceGroups';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import {
  WORKSPACE_RAIL_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
  WORKSPACE_SIDEBAR_WIDTH,
  WorkspaceSidebar,
} from '../workspaces/WorkspaceSidebar';
import { ChatScreen } from './ChatScreen';
import { useLiveRuns } from './liveRuns';
import { useAppInfo } from './useAppInfo';
import { useSidebarWidth } from './useSidebarWidth';

const parseFlag = (stored: string | null) => stored === 'true';
/** The workspace sidebar's dragged width, remembered apart from the chats sidebar's. */
const WORKSPACES_SIDEBAR = {
  key: 'agent.workspacesWidth',
  defaultWidth: WORKSPACE_SIDEBAR_WIDTH,
  minWidth: WORKSPACE_SIDEBAR_MIN_WIDTH,
};

/**
 * The layout route for `/workspaces/:workspaceId` (a new chat) and its child
 * `chats/:chatId`. It stays mounted while the child changes, so a new chat that gets
 * its id mid-stream keeps the stream. Another workspace remounts the chat screen fresh, but
 * the workspace sidebar (and the lists it shows) lives here, beside it, so switching
 * workspaces only moves its highlight: no reload, no replayed animation.
 */
export function ChatRoute() {
  const { workspaceId } = useParams();
  const chatMatch = useMatch('/workspaces/:workspaceId/chats/:chatId');
  const chatId = chatMatch?.params.chatId ?? null;
  const info = useAppInfo();
  const workspaces = useWorkspaces();
  const workspaceGroups = useWorkspaceGroups();
  const width = useSidebarWidth(WORKSPACES_SIDEBAR);
  const [isCollapsed, setIsCollapsed] = useStoredState('agent.workspacesCollapsed', parseFlag);

  const liveRuns = useLiveRuns();
  const runningWorkspaceIds = useMemo(
    () => new Set(liveRuns.map((run) => run.workspaceId)),
    [liveRuns],
  );

  if (!workspaceId) return <Navigate to="/" replace />;

  const list = workspaces.data ?? [];
  const current = list.find((w) => w.id === workspaceId) ?? null;
  const { reload: reloadWorkspaces } = workspaces;
  const { reload: reloadGroups } = workspaceGroups;
  // The column's width animates when it collapses to the rail (not while it's dragged:
  // `.panel-grid` turns transitions off then).
  const style = {
    '--workspaces-w': `${width.width}px`,
    width: `${isCollapsed ? WORKSPACE_RAIL_WIDTH : width.width}px`,
  } as CSSProperties;

  return (
    <div className="flex h-full min-h-0">
      <div
        className="panel-grid hidden min-h-0 shrink-0 grid-cols-1 grid-rows-[minmax(0,1fr)] transition-[width] duration-300 ease-emphasized motion-reduce:transition-none xl:grid"
        style={style}
      >
        <WorkspaceSidebar
          current={current}
          workspaces={list}
          runningWorkspaceIds={runningWorkspaceIds}
          info={info.data}
          infoError={info.error}
          groups={workspaceGroups.data ?? []}
          isCollapsed={isCollapsed}
          width={width}
          onToggle={() => setIsCollapsed(!isCollapsed)}
          onFiled={(id, groupId) =>
            workspaces.setData((all) =>
              all ? all.map((w) => (w.id === id ? { ...w, groupId } : w)) : all,
            )
          }
          onChanged={() => {
            reloadWorkspaces();
            reloadGroups();
          }}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <ChatScreen
          key={workspaceId}
          workspaceId={workspaceId}
          chatId={chatId}
          info={info}
          workspaces={workspaces}
        />
      </div>
    </div>
  );
}
