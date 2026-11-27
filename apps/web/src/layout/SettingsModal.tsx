import { useState } from 'react';
import { Outlet, useLocation, type Location } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { SettingsSideTabs } from '../features/settings/SettingsTabs';
import { GearIcon } from '../lib/icons';
import {
  PageHeaderProvider,
  useFooterSlotRef,
  useHeaderState,
  useTopbarSlotRef,
} from './pageHeader';

/** Pages that open as a popup over the chat: app settings and the workspace form. */
const isPopupPath = (path: string) =>
  path.startsWith('/settings/') ||
  path === '/workspaces/new' ||
  /^\/workspaces\/[^/]+\/(settings|agent-settings)\/?$/.test(path);
/** The chat screen (`/workspaces/:id` or one of its chats), not a workspace form. */
const isChatPath = (path: string) =>
  /^\/workspaces\/[^/]+(\/chats\/[^/]+)?\/?$/.test(path) && !path.startsWith('/workspaces/new');

/**
 * Where a settings or workspace form page was opened from, so it shows as a popup over that
 * screen: going from the chat screen to one keeps the chat as the background until you leave
 * those pages again. One opened directly (or reloaded) has none: a full page.
 */
export function useSettingsBackground(location: Location): Location | null {
  const [seen, setSeen] = useState<{ location: Location; background: Location | null }>({
    location,
    background: null,
  });
  if (seen.location === location) return seen.background;

  const previous = seen.location;
  const background = !isPopupPath(location.pathname)
    ? null
    : isPopupPath(previous.pathname)
      ? seen.background
      : isChatPath(previous.pathname)
        ? previous
        : null;
  // Adjusting state while rendering, React's pattern for state derived from a changing prop.
  setSeen({ location, background });
  return background;
}

function SettingsModalFrame({ onClose }: { onClose: () => void }) {
  const header = useHeaderState();
  const setFooterNode = useFooterSlotRef();
  const setActionsNode = useTopbarSlotRef();
  // App settings (Preferences) get their pages as side tabs; the workspace form stands alone.
  const isAppSettings = useLocation().pathname.startsWith('/settings/');
  return (
    <Modal
      title={header?.title ?? 'Settings'}
      description={header?.subtitle}
      icon={<GearIcon size={15} />}
      size="xl"
      onClose={onClose}
      // A page's own buttons (TopbarActions) land in the header, before Close.
      actions={<div ref={setActionsNode} className="flex flex-wrap items-center gap-2 empty:hidden" />}
      // A form's buttons (FormActions) land here; pages without any leave it empty and hidden.
      footer={
        <div ref={setFooterNode} className="flex flex-1 flex-wrap items-center justify-end gap-2" />
      }
    >
      <div className="min-h-full px-5 pb-5 pt-2">
        {isAppSettings ? (
          <SettingsSideTabs>
            <Outlet />
          </SettingsSideTabs>
        ) : (
          <Outlet />
        )}
      </div>
    </Modal>
  );
}

/** The settings pages (Models, Agent, MCP servers and their forms) or the workspace form in a popup. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <PageHeaderProvider>
      <SettingsModalFrame onClose={onClose} />
    </PageHeaderProvider>
  );
}
