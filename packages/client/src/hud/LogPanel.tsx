// LogPanel — DESIGN.md §6/§11 right rail: a collapsible ship's-log Panel.
// This story ships the PANEL + localized EmptyState only — event-log
// CONTENT (trade history, per-event mono lines) is a later story.
import { useTranslation } from '../i18n/index.js';
import { EmptyState } from './components/EmptyState.js';
import { Panel } from './components/Panel.js';

export function LogPanel() {
  const { t } = useTranslation();

  return (
    <Panel
      title={t('hud.log.title')}
      collapseLabel={t('hud.log.collapse')}
      expandLabel={t('hud.log.expand')}
    >
      <EmptyState message={t('hud.log.empty')} />
    </Panel>
  );
}
