/**
 * Compat-layer.
 *
 * Когда захотим заменить vanilla-модалки одним свитчем — этот файл регистрирует
 * глобальный `window.AsgardUI` с API совместимым со старым (showModal/confirm/prompt/
 * hideModal/replaceModal/showDrawer).
 *
 * Сейчас работает ТОЛЬКО внутри Asgard 2.0 (когда подключено React-приложение).
 * Чтобы внедрить в vanilla — нужно будет:
 *   1) В public/index.html (классическая версия) подключить React-bundle с этим shim
 *   2) Удалить старый `ui.js`
 *
 * Маппинг (старое → новое):
 *   AsgardUI.showModal(title|opts, html?) → open(<ConfirmModal/FormModal/...>)
 *     По html-маркерам определяем тип
 *   AsgardUI.confirm(title, message)     → open(<ConfirmModal>) + Promise<bool>
 *   AsgardUI.prompt(label)               → open(<PromptModal>) + Promise<string|null>
 *   AsgardUI.hideModal()                 → close() топа
 *   AsgardUI.replaceModal(...)           → replace()
 *   AsgardUI.showDrawer({title,html})    → open(<DrawerModal>, { size: 'drawer-right' })
 *   AsgardUI.toast(...)                  → не модалка — оставляем оригинальную или sonner
 */
import { getGlobalModalApi } from './ModalProvider';
import { ConfirmModal } from './Confirm';
import { PromptModal } from './Prompt';
import { DrawerModal } from './Drawer';
import { AlertModal } from './Alert';

/**
 * Установить совместимость с window.AsgardUI.
 * Если флаг `replace=true` — переопределяет существующий AsgardUI (для боевой замены).
 * Если `false` (по умолчанию) — публикует под AsgardUI2, чтобы не сломать vanilla.
 */
export function installAsgardCompat({ replace = false } = {}) {
  const api = {
    /* Confirm */
    confirm(title, message, opts = {}) {
      const m = getGlobalModalApi();
      if (!m) return Promise.resolve(window.confirm(message || title));
      return new Promise((resolve) => {
        m.open(
          <ConfirmModal
            title={title}
            message={message}
            tone={opts.tone || 'info'}
            okText={opts.okText || 'OK'}
            cancelText={opts.cancelText || 'Отмена'}
            onConfirm={() => resolve(true)}
            onCancel={() => resolve(false)}
          />,
          { dismissOnClick: false }
        );
      });
    },

    /* Prompt (old style — простой ввод с одним полем) */
    prompt(title, opts = {}) {
      const m = getGlobalModalApi();
      if (!m) return Promise.resolve(window.prompt(title) || null);
      return new Promise((resolve) => {
        m.open(
          <PromptModal
            title={title}
            label={opts.label || 'Введите значение'}
            placeholder={opts.placeholder || ''}
            initial={opts.initial || ''}
            multiline={!!opts.multiline}
            required={opts.required !== false}
            okText={opts.okText || 'OK'}
            onSubmit={(v) => resolve(v)}
            onCancel={() => resolve(null)}
          />,
          { dismissOnClick: false }
        );
      });
    },

    /* Show — основной API (раньше через HTML строку). В compat мы рендерим
     * минимальный AlertModal с html-fallback. Для серьёзных модалок код
     * должен мигрировать на use modals напрямую (open(<FormModal/>) etc.). */
    showModal(arg, html) {
      const m = getGlobalModalApi();
      if (!m) return null;
      let title, body, opts = {};
      if (typeof arg === 'string') {
        title = arg;
        body = html;
      } else {
        title = arg?.title;
        body = arg?.html || html;
        opts = arg || {};
      }
      m.open(
        <AlertModal
          tone={opts.tone || 'info'}
          title={title}
          icon={opts.icon}
          message={
            typeof body === 'string'
              ? <span dangerouslySetInnerHTML={{ __html: body }} />
              : body
          }
          okText="Закрыть"
        />,
        { size: opts.wide ? 'wide' : 'center' }
      );
    },

    hideModal() { getGlobalModalApi()?.close(); },
    closeModal() { getGlobalModalApi()?.close(); },

    replaceModal(arg, html) {
      const m = getGlobalModalApi();
      if (!m) return;
      let title, body, opts = {};
      if (typeof arg === 'string') { title = arg; body = html; }
      else { title = arg?.title; body = arg?.html || html; opts = arg || {}; }
      m.replace(
        <AlertModal title={title} icon={opts.icon} message={typeof body === 'string' ? <span dangerouslySetInnerHTML={{ __html: body }} /> : body} />,
        { size: opts.wide ? 'wide' : 'center' }
      );
    },

    showDrawer(opts = {}) {
      const m = getGlobalModalApi();
      if (!m) return;
      m.open(
        <DrawerModal title={opts.title} icon={opts.icon} accent={opts.accent || 'default'} subtitle={opts.subtitle}>
          {typeof opts.html === 'string' ? <span dangerouslySetInnerHTML={{ __html: opts.html }} /> : opts.html}
        </DrawerModal>,
        { size: opts.wide ? 'drawer-right wide' : 'drawer-right', shape: 'drawer-right' }
      );
    },

    /* Toast — оставляем оригинал, если есть; иначе no-op (без утечки в консоль) */
    toast: window.AsgardUI?.toast || (() => {})
  };

  const target = replace ? 'AsgardUI' : 'AsgardUI2';
  window[target] = api;
  return api;
}

/* Авто-установка под AsgardUI2 (не ломая vanilla AsgardUI) */
if (typeof window !== 'undefined') {
  // Подождём чтобы _globalApi проинициализировался
  setTimeout(() => installAsgardCompat({ replace: false }), 0);
}
