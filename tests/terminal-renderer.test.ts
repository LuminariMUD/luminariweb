import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertLuminariColorCodes,
  createMudHtmlStreamConverter,
  luminariRgbToAnsi,
  renderMudHtml,
  renderMudStreamHtml,
} from '../src/terminal/render-mud-html.ts';

test('escapes literal HTML and angle brackets in MUD output', () => {
  const html = renderMudHtml('<script attr="x">&value</script>');

  assert.equal(html, '&lt;script attr=&quot;x&quot;&gt;&amp;value&lt;/script&gt;');
  assert.doesNotMatch(html, /<script/);
});

test('preserves ANSI foreground color conversion while escaping text', () => {
  const html = renderMudHtml('\u001b[31mred <alert>\u001b[0m');

  assert.match(html, /<span style="color:#A00">red &lt;alert&gt;<\/span>/);
});

test('converts Luminari foreground, background, and reset codes', () => {
  assert.equal(convertLuminariColorCodes('^Rred^n'), '\u001b[38;2;255;0;0mred\u001b[0;00m');
  assert.equal(luminariRgbToAnsi('B005'), '\u001b[48;2;0;0;255m');

  assert.equal(renderMudHtml('^Rred^n'), '<span style="color:#ff0000">red</span>');
  assert.equal(
    renderMudHtml('^[B005]blue background^n'),
    '<span style="background-color:#0000ff">blue background</span>',
  );
});

test('keeps literal caret escapes and unknown codes visible', () => {
  const text = convertLuminariColorCodes('literal ^^ caret ^z unknown ^');

  assert.equal(text, 'literal ^ caret ^z unknown ^');
});

test('stream renderer keeps XML escaping, newlines, and Luminari colors', () => {
  const converter = createMudHtmlStreamConverter();
  const html = renderMudStreamHtml('line 1\n^Ggreen <safe>^n', converter);

  assert.equal(html, 'line 1<br/><span style="color:#00ff00">green &lt;safe&gt;</span>');
});
