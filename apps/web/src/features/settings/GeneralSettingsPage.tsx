import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DEFAULT_AGENT_SETTINGS,
  LOG_LEVELS,
  SETTINGS_LIMITS,
  agentSettingsSchema,
  type AgentSettings,
  type LogLevel,
} from '@app/shared';
import { Button } from '../../components/Button';
import { INPUT_ERROR, INPUT_OK } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { APP_NAME } from '../../lib/brand';
import { GlobeIcon, TerminalIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { fetchGlobalSettings, saveGlobalSettings } from './globalApi';
import { SettingsTabs } from './SettingsTabs';
import { CONTROL, Row, Section, Segmented } from './SettingsUi';

type Draft = { searxngUrl: string; logLevel: LogLevel };

const LOG_TEXT: Record<LogLevel, string> = {
  debug: 'Every event',
  info: 'Steps and problems',
  silent: 'Nothing',
};

const pick = (settings: AgentSettings): Draft => ({
  searxngUrl: settings.searxngUrl,
  logLevel: settings.logLevel,
});

/**
 * `/settings/general`: app-wide settings every workspace shares, the web search instance and
 * the server's console log level. Saved in ~/.code-ai/agent-settings.json with the rest of the
 * app-wide agent settings (which this page leaves as they are).
 */
export function GeneralSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? '/';

  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);

  usePageHeader({
    title: 'Settings',
    subtitle: 'Shared by every workspace. Changes apply from the next message.',
    breadcrumbs: [{ label: APP_NAME, to: backTo }, { label: 'General' }],
  });

  useEffect(() => {
    let isCurrent = true;
    fetchGlobalSettings()
      .then((settings) => {
        if (!isCurrent) return;
        setSaved(pick(settings));
        setDraft(pick(settings));
      })
      .catch((cause: unknown) => {
        if (isCurrent) setLoadError(cause);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  if (!draft || !saved) {
    return (
      <div className="w-full">
        <SettingsTabs />
        {loadError ? (
          <p
            role="alert"
            className="rounded-xl border border-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
          >
            {errorMessage(loadError, "Couldn't load the settings.")}
          </p>
        ) : (
          <PageLoader />
        )}
      </div>
    );
  }

  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const defaults = pick(DEFAULT_AGENT_SETTINGS);
  const isDefault = JSON.stringify(defaults) === JSON.stringify(draft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = agentSettingsSchema.shape.searxngUrl.safeParse(draft.searxngUrl);
    if (!checked.success) {
      setUrlError(checked.error.issues[0]?.message ?? 'Check the URL.');
      return;
    }
    setUrlError(null);
    setIsSaving(true);
    try {
      // The other app-wide settings are saved whole too: start from the latest.
      const latest = await fetchGlobalSettings();
      const next = await saveGlobalSettings({
        ...latest,
        searxngUrl: checked.data,
        logLevel: draft.logLevel,
      });
      setSaved(pick(next));
      setDraft(pick(next));
      toast('Settings saved');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the settings."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full">
      <SettingsTabs />

      <form
        id="general-settings-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <Section
          icon={<GlobeIcon size={15} />}
          title="Web search"
          description="Where the web_search tool looks things up, in every workspace."
        >
          <Row
            label="SearXNG URL"
            htmlFor="setting-searxng"
            description="The search instance web_search uses."
            hint="Needs the JSON format turned on (search.formats: [html, json])."
            error={urlError ?? undefined}
            isWide
          >
            <input
              id="setting-searxng"
              value={draft.searxngUrl}
              autoComplete="off"
              spellCheck={false}
              maxLength={SETTINGS_LIMITS.searxngUrl}
              placeholder={DEFAULT_AGENT_SETTINGS.searxngUrl}
              aria-invalid={urlError ? true : undefined}
              onChange={(event) => {
                setDraft({ ...draft, searxngUrl: event.target.value });
                setUrlError(null);
              }}
              className={`${CONTROL} ${urlError ? INPUT_ERROR : INPUT_OK} w-full font-mono text-[12px] sm:w-72`}
            />
          </Row>
        </Section>

        <Section
          icon={<TerminalIcon size={15} />}
          title="Logging"
          description="What the server prints while the agent works."
        >
          <Row
            label="Console log level"
            description={`${LOG_TEXT[draft.logLevel]} in the server's terminal.`}
            hint="Each run is also written to a JSONL log in ~/.code-ai/logs (move it with AGENT_LOG_DIR in .env)."
          >
            <Segmented
              label="Console log level"
              value={draft.logLevel}
              options={LOG_LEVELS.map((level) => ({
                value: level,
                title: level.charAt(0).toUpperCase() + level.slice(1),
                detail: LOG_TEXT[level],
              }))}
              onChange={(level) => setDraft({ ...draft, logLevel: level })}
            />
          </Row>
        </Section>
      </form>

      <FormActions>
        <Button
          variant="plain"
          className="mr-auto"
          disabled={isDefault || isSaving}
          onClick={() => {
            setDraft(defaults);
            setUrlError(null);
          }}
          title="Fill in the defaults; nothing changes until you save"
        >
          Reset to defaults
        </Button>
        <Button onClick={() => navigate(backTo)}>{isDirty ? 'Cancel' : 'Back'}</Button>
        <Button
          variant="primary"
          type="submit"
          form="general-settings-form"
          disabled={!isDirty || isSaving}
        >
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </FormActions>
    </div>
  );
}
