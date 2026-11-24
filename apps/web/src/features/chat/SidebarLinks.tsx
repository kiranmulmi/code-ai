import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AppInfo } from '@app/shared';
import { Badge } from '../../components/Badge';
import { ThemeToggle } from '../../layout/ThemeToggle';
import { errorMessage } from '../../lib/api';
import { GearIcon, InstallIcon, PlusIcon, WarnIcon } from '../../lib/icons';
import { useInstallApp } from '../../lib/installApp';
import { useToast } from '../../lib/toast';

const ROW = 'flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium text-ink-2';

function SidebarLink({
  to,
  icon,
  label,
  isBusy,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  /** the agent is working: the page waits until it's done */
  isBusy: boolean;
}) {
  const { pathname } = useLocation();
  const iconBox = (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2">
      {icon}
    </span>
  );
  if (isBusy) {
    return (
      <span title="Wait for the agent to finish" className={`${ROW} cursor-not-allowed opacity-50`}>
        {iconBox}
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  }
  return (
    <Link
      to={to}
      state={{ from: pathname }}
      className={`${ROW} transition-colors hover:bg-subtle hover:text-ink`}
    >
      {iconBox}
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

/**
 * Preferences: the app settings (models, MCP servers, agent) in a popup, open even while the
 * agent works. A badge says when approvals aren't "ask", since that changes what the agent may
 * do without asking. At `xl` the chat screen has no top bar, so the theme switch sits here.
 */
function PreferencesRow({ approval }: { approval: AppInfo['approval'] | null }) {
  const { pathname } = useLocation();
  return (
    <div className="flex items-center gap-1">
      <Link
        to="/settings/models"
        state={{ from: pathname }}
        title="Models, MCP servers and agent settings"
        className={`${ROW} min-w-0 flex-1 transition-colors hover:bg-subtle hover:text-ink`}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2">
          <GearIcon size={12} />
        </span>
        <span className="min-w-0 truncate">Preferences</span>
        {approval === 'auto' ? (
          <Badge tone="yellow">auto-approve</Badge>
        ) : approval === 'deny' ? (
          <Badge tone="red">refuse</Badge>
        ) : null}
      </Link>
      <span className="hidden shrink-0 xl:contents">
        <ThemeToggle size="sm" />
      </span>
    </div>
  );
}

/**
 * The sidebar links for the chats drawer (mobile): the open workspace's settings,
 * New workspace, Preferences (the app-wide settings), and Install app while Chrome offers it.
 * A warning takes the top when the server can't be reached. Who is signed in, and Sign out,
 * are in `AccountMenu` below the workspace switcher.
 *
 * At `xl` these links are not used: Workspace settings sits at the bottom of the chats sidebar
 * (see `WorkspaceSettingsRow` in `ChatSidebar`), and the app links (New workspace, Preferences,
 * Install app) are in the workspace sidebar.
 */
export function SidebarLinks({
  info,
  error,
  workspaceId,
  isBusy,
  only,
}: {
  info: AppInfo | null;
  error: unknown;
  workspaceId?: string;
  isBusy: boolean;
  /**
   * At `xl` the links are split: `workspace` (Workspace settings, for the chats drawer on mobile)
   * and `app` (the offline warning, New workspace, Preferences, Install app, in the workspace
   * sidebar). Unset shows all (used for the chats drawer on mobile).
   */
  only?: 'workspace' | 'app';
}) {
  const hasWorkspace = only !== 'app' && workspaceId !== undefined;
  const hasApp = only !== 'workspace';
  const isOffline = hasApp && Boolean(error) && !info;
  const { canInstall, install } = useInstallApp();
  const toast = useToast();
  return (
    <div className="shrink-0 px-3 pb-2 pt-3">
      {isOffline && (
        <p
          role="alert"
          title={errorMessage(error)}
          className="mb-2 flex items-center gap-2 rounded-xl border border-danger-line bg-danger-bg px-3 py-2 text-[12.5px] font-medium text-danger"
        >
          <WarnIcon size={13} className="shrink-0" />
          Can&apos;t reach the server
        </p>
      )}
      {hasWorkspace && (
        <>
          <span className="block px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-4">
            Settings
          </span>
          <SidebarLink
            to={`/workspaces/${workspaceId}/settings`}
            icon={<GearIcon size={12} />}
            label="Workspace settings"
            isBusy={isBusy}
          />
        </>
      )}
      {hasApp && (
        <SidebarLink
          to="/workspaces/new"
          icon={<PlusIcon size={12} />}
          label="New workspace"
          isBusy={isBusy}
        />
      )}
      {hasApp && <PreferencesRow approval={info?.approval ?? null} />}
      {/* Only while Chrome offers it: gone once installed, and inside the installed app. */}
      {hasApp && canInstall && (
        <button
          type="button"
          onClick={() => {
            void install().then((isInstalled) => {
              if (isInstalled) toast('Installed. Open Hamro AI from your apps.');
            });
          }}
          title="Open Hamro AI in its own window, from your dock or start menu"
          className={`${ROW} w-full text-left transition-colors hover:bg-subtle hover:text-ink`}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent text-on-accent">
            <InstallIcon size={12} />
          </span>
          Install app
        </button>
      )}
    </div>
  );
}
