// Offline tests for the Agents tab's form logic. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DRAFT,
  checkDraft,
  describeAccess,
  draftWarning,
  fixTarget,
  isSameDraft,
  toggleGroup,
} from '../src/features/agents/agentDraft';
import {
  LOWER_PANEL_TABS,
  PANEL_TAB_LABEL,
  parseLowerPanelTab,
} from '../src/features/panel/panelTabs';

test('the form is checked as the API checks it, one message per field', () => {
  const empty = checkDraft(EMPTY_DRAFT);
  assert.ok(!empty.ok);
  assert.deepEqual(Object.keys(empty.errors).sort(), ['description', 'name']);

  const noTools = checkDraft({ ...EMPTY_DRAFT, name: 'x', description: 'd', toolGroups: [] });
  assert.ok(!noTools.ok);
  assert.equal(noTools.errors.toolGroups, 'Pick at least one tool group.');

  // The typed name is tidied before it's checked.
  const ok = checkDraft({
    ...EMPTY_DRAFT,
    name: 'Security Auditor!',
    description: ' Finds  holes. ',
  });
  assert.ok(ok.ok);
  assert.equal(ok.data.name, 'security-auditor');
  assert.equal(ok.data.description, 'Finds holes.');
});

test('tool groups toggle in the app order, and a change is noticed', () => {
  assert.deepEqual(toggleGroup(['web'], 'files', true), ['files', 'web']);
  assert.deepEqual(toggleGroup(['files', 'web'], 'files', false), ['web']);
  assert.ok(isSameDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, toolGroups: [...EMPTY_DRAFT.toolGroups] }));
  assert.ok(!isSameDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, readOnly: true }));
  assert.ok(!isSameDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, toolGroups: ['files'] }));
});

test('read-only with commands warns, since read-only drops commands', () => {
  assert.equal(draftWarning({ readOnly: false, toolGroups: ['commands'] }), null);
  assert.equal(draftWarning({ readOnly: true, toolGroups: ['files'] }), null);
  assert.match(draftWarning({ readOnly: true, toolGroups: ['commands'] }) ?? '', /no tools/);
  assert.match(
    draftWarning({ readOnly: true, toolGroups: ['files', 'commands'] }) ?? '',
    /won’t get/,
  );
});

test('each row says what the specialist may do', () => {
  assert.equal(describeAccess(EMPTY_DRAFT), 'All tools');
  assert.equal(
    describeAccess({ toolGroups: ['files', 'web'], readOnly: true, model: 'review' }),
    'Files, Web · read-only · reviewer model',
  );
});

test('fixing a broken file keeps a good name, or tidies it and replaces the old file', () => {
  assert.deepEqual(fixTarget('helper.md'), { name: 'helper', replacesFile: null });
  assert.deepEqual(fixTarget('Bad_Name.md'), { name: 'bad-name', replacesFile: 'Bad_Name.md' });
});

test('the Agents tab sits next to Skills', () => {
  assert.deepEqual(LOWER_PANEL_TABS.slice(0, 2), ['skills', 'agents']);
  assert.equal(PANEL_TAB_LABEL.agents, 'Agents');
  assert.equal(parseLowerPanelTab('agents'), 'agents');
});
