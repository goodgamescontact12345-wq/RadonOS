import { loadSettings } from '../../shared/settings.js';
import { initTheme } from '../../shared/theme.js';

/**
 * A small expression calculator. It parses the expression itself rather than
 * handing it to the browser: no eval, no Function constructor, so it keeps
 * working under the extension's CSP.
 */
const $ = (selector) => document.querySelector(selector);

const out = $('#calc-out');
const exprLine = $('#calc-expr');
let expression = '';
let lastResult = null;

function tokenise(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[0-9.]/.test(char)) {
      let number = '';
      while (index < source.length && /[0-9.]/.test(source[index])) number += source[index++];
      if ((number.match(/\./g) || []).length > 1) throw new Error('bad number');
      tokens.push({ type: 'number', value: Number(number) });
      continue;
    }
    if ('+-*/()%'.includes(char)) { tokens.push({ type: 'op', value: char }); index += 1; continue; }
    throw new Error(`unexpected ${char}`);
  }
  return tokens;
}

/** Recursive descent: expression → term → factor → unary. */
function evaluate(source) {
  const tokens = tokenise(source);
  let position = 0;
  const peek = () => tokens[position];
  const eat = (value) => {
    const token = tokens[position];
    if (!token || token.value !== value) return false;
    position += 1;
    return true;
  };

  function parseExpression() {
    let value = parseTerm();
    for (;;) {
      if (eat('+')) value += parseTerm();
      else if (eat('-')) value -= parseTerm();
      else return value;
    }
  }
  function parseTerm() {
    let value = parseFactor();
    for (;;) {
      if (eat('*')) value *= parseFactor();
      else if (eat('/')) value /= parseFactor();
      else if (eat('%')) value %= parseFactor();
      else return value;
    }
  }
  function parseFactor() {
    if (eat('-')) return -parseFactor();
    if (eat('+')) return parseFactor();
    if (eat('(')) {
      const value = parseExpression();
      if (!eat(')')) throw new Error('missing )');
      return value;
    }
    const token = peek();
    if (!token || token.type !== 'number') throw new Error('expected a number');
    position += 1;
    return token.value;
  }

  const result = parseExpression();
  if (position !== tokens.length) throw new Error('trailing input');
  return result;
}

function format(value) {
  if (!Number.isFinite(value)) return 'Error';
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

function repaint() {
  const shown = expression || (lastResult !== null ? format(lastResult) : '0');
  out.textContent = shown || '0';
  exprLine.textContent = lastResult !== null && !expression ? `${format(lastResult)}` : '';
}

function press(key) {
  if (key === 'clear') {
    expression = '';
    lastResult = null;
    repaint();
    return;
  }
  if (key === 'back') {
    expression = expression.slice(0, -1);
    repaint();
    return;
  }
  if (key === '=') {
    if (!expression) return;
    try {
      const value = evaluate(expression);
      lastResult = value;
      out.textContent = format(value);
      exprLine.textContent = `${expression} =`;
      expression = '';
    } catch {
      out.textContent = 'Error';
      exprLine.textContent = expression;
      expression = '';
    }
    return;
  }
  expression += key;
  repaint();
}

$('#calc-pad').addEventListener('click', (event) => {
  const button = event.target.closest('[data-key]');
  if (!button) return;
  press(button.dataset.key);
});

document.addEventListener('keydown', (event) => {
  const map = { Enter: '=', '=': '=', Backspace: 'back', Escape: 'clear', ',': '.' };
  if (/^[0-9.+\-*/()%]$/.test(event.key)) press(event.key);
  else if (map[event.key]) press(map[event.key]);
  else return;
  event.preventDefault();
});

await loadSettings();
await initTheme();
press('clear');
