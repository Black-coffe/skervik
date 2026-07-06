// NoticeBar — DESIGN.md §7.6/§10: a dismissable, `aria-live="polite"` failure
// notice for a server `intent.rejected` (a `validate` refusal) or `intent.error`
// (an infra failure). The live region is ALWAYS in the DOM so a screen reader
// announces the change; the message row is conditional. Keyboard-reachable
// dismiss with a visible focus ring (the shared `.btn` styles).
import './NoticeBar.css';

import { useTranslation } from '../i18n/index.js';
import { noticeCopy } from './notice.js';
import { useUiStore } from './store.js';

export function NoticeBar() {
  const { t } = useTranslation();
  const notice = useUiStore((s) => s.notice);
  const dismissNotice = useUiStore((s) => s.dismissNotice);

  const copy = notice ? noticeCopy(notice) : null;

  return (
    <div
      className="notice-bar"
      role="status"
      aria-live="polite"
      aria-label={t('a11y.notice')}
    >
      {copy ? (
        <div className="notice-bar__item">
          <span className="notice-bar__icon" aria-hidden="true">
            ⚠
          </span>
          <span className="notice-bar__text">{t(copy.key, copy.params)}</span>
          <button
            type="button"
            className="btn btn--quiet notice-bar__dismiss"
            onClick={dismissNotice}
          >
            {t('notice.dismiss')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
