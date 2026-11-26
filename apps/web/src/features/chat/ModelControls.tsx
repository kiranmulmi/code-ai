import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ModelCategory, ModelProfile, ReasoningEffort } from '@app/shared';
import { Badge } from '../../components/Badge';
import {
  ChevronRightIcon,
  GearIcon,
  ImageIcon,
  MicIcon,
  PlusIcon,
  SparkIcon,
} from '../../lib/icons';
import { CATEGORY_INFO, splitModels } from '../models/categories';
import { serverLabel } from '../models/servers';
import { ComposerMenu, ComposerMenuItem } from './ComposerMenu';
import type { ModelChoice } from './useModelChoice';

const EFFORTS: { value: ReasoningEffort | null; label: string; detail: string }[] = [
  { value: null, label: 'Auto', detail: "The model server's default" },
  { value: 'low', label: 'Low', detail: 'Quick answers, the fewest thinking tokens' },
  { value: 'medium', label: 'Medium', detail: 'Balanced speed and depth' },
  { value: 'high', label: 'High', detail: 'Thinks longest: slower and costs more' },
];

const FOOTER_LINK =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink-2 outline-none transition-colors hover:bg-subtle hover:text-ink focus-visible:bg-subtle';

const ROW =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle';

/** The voice and image models, picked next to the chat's (saved in the workspace / agent settings). */
export interface HelperModels {
  voiceModelId: string | null;
  imageModelId: string | null;
  chooseVoiceModel: (id: string | null) => void;
  chooseImageModel: (id: string | null) => void;
}

/**
 * One chip for the models in use: the chat model the next message goes to (and, for reasoning
 * models, how hard it thinks), plus small marks for the voice and image models. Its menu has
 * a row for each, opening its own list; every saved model can be picked for every use, the
 * matching category listed first. With no model set up yet, a link to add one instead.
 */
export function ModelControls({
  models,
  choice,
  helpers,
  disabled,
  onChooseModel,
  onChooseEffort,
}: {
  /** Null while loading. */
  models: ModelProfile[] | null;
  choice: ModelChoice;
  helpers: HelperModels;
  disabled: boolean;
  onChooseModel: (id: string) => void;
  onChooseEffort: (effort: ReasoningEffort | null) => void;
}) {
  const { pathname } = useLocation();
  const { model, effort } = choice;

  if (models && models.length === 0) {
    return (
      <Link
        to="/settings/models/new"
        state={{ from: pathname }}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent-2 transition-colors hover:bg-accent-bg"
      >
        <PlusIcon size={11} /> Add a model to start
      </Link>
    );
  }
  if (!models || !model) return <span className="h-7" />;

  const effortLabel = EFFORTS.find((option) => option.value === effort)?.label ?? 'Auto';
  const voiceModel = models.find((m) => m.id === helpers.voiceModelId) ?? null;
  const imageModel = models.find((m) => m.id === helpers.imageModelId) ?? null;

  const title = [
    `Chat: ${model.name} (${model.model} at ${serverLabel(model)})${
      model.supportsReasoning ? ` · reasoning effort: ${effortLabel}` : ''
    }`,
    `Voice: ${voiceModel ? voiceModel.name : 'off'}`,
    `Image: ${imageModel ? imageModel.name : 'none'}`,
  ].join('\n');

  return (
    <ComposerMenu
      label={
        <>
          {model.name}
          {model.supportsReasoning && <span className="text-ink-3"> {effortLabel}</span>}
          {voiceModel && (
            <HelperMark icon={<MicIcon size={10} />} label={`Voice: ${voiceModel.name}`} />
          )}
          {imageModel && (
            <HelperMark icon={<ImageIcon size={10} />} label={`Image: ${imageModel.name}`} />
          )}
        </>
      }
      icon={<SparkIcon size={12} className="shrink-0 text-accent" />}
      title={title}
      menuLabel="Models"
      showHeading={false}
      disabled={disabled}
      className="max-w-[min(320px,56vw)]"
      menuWidth="w-[min(380px,calc(100vw-40px))]"
      footer={(close) => (
        <Link
          to="/settings/models"
          state={{ from: pathname }}
          role="menuitem"
          onClick={close}
          className={FOOTER_LINK}
        >
          <GearIcon size={13} className="text-ink-3" /> Manage models
        </Link>
      )}
    >
      {(close) => (
        <ModelMenuBody
          models={models}
          model={model}
          voiceModel={voiceModel}
          imageModel={imageModel}
          effort={effort}
          effortLabel={effortLabel}
          onChooseModel={(id) => {
            onChooseModel(id);
            close();
          }}
          onChooseEffort={(value) => {
            onChooseEffort(value);
            close();
          }}
          onChooseVoice={(id) => {
            helpers.chooseVoiceModel(id);
            close();
          }}
          onChooseImage={(id) => {
            helpers.chooseImageModel(id);
            close();
          }}
        />
      )}
    </ComposerMenu>
  );
}

/** A small icon in the chip saying a voice or image model is picked. */
function HelperMark({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      aria-label={label}
      className="ml-1.5 inline-flex translate-y-[1px] items-center text-ink-3"
    >
      {icon}
    </span>
  );
}

type View = 'root' | 'chat' | 'effort' | 'voice' | 'image';

/** The open menu. Mounted each time it opens, so it always starts at the top level. */
function ModelMenuBody({
  models,
  model,
  voiceModel,
  imageModel,
  effort,
  effortLabel,
  onChooseModel,
  onChooseEffort,
  onChooseVoice,
  onChooseImage,
}: {
  models: ModelProfile[];
  model: ModelProfile;
  voiceModel: ModelProfile | null;
  imageModel: ModelProfile | null;
  effort: ReasoningEffort | null;
  effortLabel: string;
  onChooseModel: (id: string) => void;
  onChooseEffort: (effort: ReasoningEffort | null) => void;
  onChooseVoice: (id: string | null) => void;
  onChooseImage: (id: string | null) => void;
}) {
  const [view, setView] = useState<View>('root');
  const ref = useRef<HTMLDivElement>(null);
  const isFirstView = useRef(true);

  // Moving between levels: focus the chosen item (or the first), as on opening.
  useEffect(() => {
    if (isFirstView.current) {
      isFirstView.current = false;
      return;
    }
    const body = ref.current;
    const item =
      body?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      body?.querySelector<HTMLElement>('[role^="menuitem"]');
    item?.focus();
  }, [view]);

  const backLabel: Record<Exclude<View, 'root'>, string> = {
    chat: 'Chat model',
    effort: 'Reasoning',
    voice: 'Voice model',
    image: 'Image model',
  };

  return (
    <div ref={ref}>
      {view === 'root' && (
        <>
          <SubmenuRow
            icon={<SparkIcon size={12} />}
            label="Chat model"
            value={model.name}
            onOpen={() => setView('chat')}
          />
          {model.supportsReasoning && (
            <SubmenuRow label="Reasoning" value={effortLabel} onOpen={() => setView('effort')} />
          )}
          <SubmenuRow
            icon={<MicIcon size={12} />}
            label="Voice model"
            value={voiceModel?.name ?? 'Off'}
            onOpen={() => setView('voice')}
          />
          <SubmenuRow
            icon={<ImageIcon size={12} />}
            label="Image model"
            value={imageModel?.name ?? 'None'}
            onOpen={() => setView('image')}
          />
        </>
      )}

      {view !== 'root' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => setView('root')}
            className={`${ROW} text-ink-3 hover:text-ink`}
          >
            <ChevronRightIcon size={12} className="shrink-0 rotate-180" />
            {backLabel[view]}
          </button>
          <div className="my-1 h-px bg-line-2" />
        </>
      )}

      {view === 'effort' &&
        EFFORTS.map((option) => (
          <ComposerMenuItem
            key={option.label}
            isSelected={option.value === effort}
            onSelect={() => onChooseEffort(option.value)}
            title={option.label}
            detail={option.detail}
          />
        ))}

      {view === 'chat' && (
        <ModelList
          models={models}
          category="chat"
          selectedId={model.id}
          onChoose={(id) => id && onChooseModel(id)}
        />
      )}

      {view === 'voice' && (
        <ModelList
          models={models}
          category="voice"
          selectedId={voiceModel?.id ?? null}
          noneLabel="Off"
          noneDetail="No speech to text or spoken replies in this workspace"
          onChoose={onChooseVoice}
        />
      )}

      {view === 'image' && (
        <ModelList
          models={models.filter((m) => m.supportsImages)}
          category="image"
          selectedId={imageModel?.id ?? null}
          noneLabel="None"
          noneDetail="Text-only chat models can't see images"
          onChoose={onChooseImage}
        />
      )}
    </div>
  );
}

/**
 * The models of one category only (Settings → Models). The one in use stays listed, marked
 * with its own category, when it was picked from another category before.
 * `noneLabel` adds a first option for no model.
 */
function ModelList({
  models,
  category,
  selectedId,
  noneLabel,
  noneDetail,
  onChoose,
}: {
  models: ModelProfile[];
  category: ModelCategory;
  selectedId: string | null;
  noneLabel?: string;
  noneDetail?: string;
  onChoose: (id: string | null) => void;
}) {
  const { pathname } = useLocation();
  const { matching, others } = splitModels(models, category);
  const current = others.find((entry) => entry.id === selectedId);
  const shown = current ? [...matching, current] : matching;
  const item = (entry: ModelProfile) => (
    <ComposerMenuItem
      key={entry.id}
      isSelected={entry.id === selectedId}
      onSelect={() => onChoose(entry.id)}
      title={entry.name}
      detail={<span className="font-mono">{entry.model}</span>}
      badge={
        <>
          {entry.category !== category && <Badge tone="yellow">{entry.category}</Badge>}
          {category === 'chat' && entry.isDefault && <Badge>default</Badge>}
          {category === 'chat' && entry.supportsReasoning && <Badge tone="blue">reasoning</Badge>}
          {category === 'chat' && !entry.supportsImages && <Badge>text only</Badge>}
        </>
      }
    />
  );
  return (
    <>
      {noneLabel && (
        <ComposerMenuItem
          isSelected={selectedId === null}
          onSelect={() => onChoose(null)}
          title={noneLabel}
          detail={noneDetail}
        />
      )}
      {shown.map(item)}
      {matching.length === 0 && (
        <p className="px-3.5 py-2 text-[12px] leading-snug text-ink-3">
          {CATEGORY_INFO[category].empty}{' '}
          <Link
            to={`/settings/models/new${category === 'chat' ? '' : `?category=${category}`}`}
            state={{ from: pathname }}
            className="text-accent-2 hover:underline"
          >
            Add one
          </Link>
        </p>
      )}
    </>
  );
}

/** A top-level row: what it sets, its current value, and an arrow into its list. */
function SubmenuRow({
  icon,
  label,
  value,
  onOpen,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`${ROW} text-ink-2 hover:text-ink`}
    >
      <span className="grid w-3.5 shrink-0 place-items-center text-ink-3">{icon}</span>
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-ink-3">{value}</span>
      <ChevronRightIcon size={12} className="shrink-0 text-ink-3" />
    </button>
  );
}
