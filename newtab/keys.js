import { actionForEvent, comboFor, matches, getKeys } from '../shared/shortcuts.js';

/**
 * Shell-wide shortcut dispatch. Bindings live in shared/shortcuts.js and are
 * user-editable in Settings → Keyboard; nothing here hard-codes a chord.
 *
 * The same handler runs for keys pressed on the desktop and for keys pressed
 * inside an app window (WindowManager forwards those from the app document),
 * so a shortcut behaves the same wherever the focus is.
 */
export function createShellKeys({ wm, taskbar, commandBar, controlCenter }) {
  const withActive = (fn) => () => {
    const id = wm.activeId;
    if (!id) return;
    fn(id);
  };

  const actions = {
    'window.cycle': () => { if (wm.windows.size) wm.cycle(); },
    'window.minimize': withActive((id) => wm.minimize(id)),
    'window.close': withActive((id) => wm.close(id)),

    'layout.maximize': withActive((id) => {
      const win = wm.windows.get(id);
      if (win?.maximized) wm.restoreSize(id);
      else wm.maximize(id);
    }),
    'layout.left': withActive((id) => wm.tile(id, 'left')),
    'layout.right': withActive((id) => wm.tile(id, 'right')),
    'layout.centre': withActive((id) => wm.tile(id, 'center')),
    'layout.cycleTiles': withActive((id) => wm.cycleTile(id)),

    'system.launcher': () => taskbar.toggleStartMenu?.(),
    'system.command': () => {
      if (commandBar.isOpen?.()) commandBar.close();
      else commandBar.open('');
    },
    'system.files': () => wm.open('explorer'),
    'system.terminal': () => wm.open('terminal'),
    'system.settings': () => wm.open('settings'),
    'system.lock': () => taskbar.lockScreen(),
  };

  function handle(event) {
    if (event.defaultPrevented) return false;
    const id = actionForEvent(event);
    if (!id) return false;
    if (id.startsWith('browser.')) return false; // the Browser app owns those
    if (id === 'layout.quadrant') {
      const digit = Number((event.code || '').slice(5));
      const layouts = { 1: 'top-left', 2: 'top-right', 3: 'bottom-left', 4: 'bottom-right' };
      const layout = layouts[digit];
      if (!layout) return false;
      event.preventDefault();
      if (wm.activeId) wm.tile(wm.activeId, layout);
      return true;
    }
    const run = actions[id];
    if (!run) return false;
    event.preventDefault();
    event.stopPropagation();
    run();
    return true;
  }

  return {
    handle,
    actions,
    hint: (id) => comboFor(id),
    /** Shortcut currently bound to an action, for tooltips. */
    keys: getKeys,
    matchesAction(id, event) {
      return matches(getKeys()[id], event);
    },
  };
}

/**
 * True when the event came from a field where a letter would be typed. Modifier
 * chords are still allowed through; plain typing never reaches the shell.
 */
export function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
