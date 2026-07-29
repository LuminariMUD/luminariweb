import AnsiToHtml from 'ansi-to-html';

const LUMINARI_COLOR_CHAR = '^';

const LUMINARI_COLOR_CODES: Record<string, string> = {
  n: '\u001b[0;00m',
  d: luminariRgbToAnsi('F000'),
  D: luminariRgbToAnsi('F111'),
  '1': luminariRgbToAnsi('F022'),
  '2': luminariRgbToAnsi('F055'),
  '3': luminariRgbToAnsi('F555'),
  r: luminariRgbToAnsi('F200'),
  R: luminariRgbToAnsi('F500'),
  g: luminariRgbToAnsi('F020'),
  G: luminariRgbToAnsi('F050'),
  y: luminariRgbToAnsi('F220'),
  Y: luminariRgbToAnsi('F550'),
  b: luminariRgbToAnsi('F002'),
  B: luminariRgbToAnsi('F005'),
  m: luminariRgbToAnsi('F202'),
  M: luminariRgbToAnsi('F505'),
  c: luminariRgbToAnsi('F022'),
  C: luminariRgbToAnsi('F055'),
  w: luminariRgbToAnsi('F222'),
  W: luminariRgbToAnsi('F555'),
  a: luminariRgbToAnsi('F014'),
  A: luminariRgbToAnsi('F025'),
  j: luminariRgbToAnsi('F031'),
  J: luminariRgbToAnsi('F142'),
  l: luminariRgbToAnsi('F140'),
  L: luminariRgbToAnsi('F250'),
  o: luminariRgbToAnsi('F520'),
  O: luminariRgbToAnsi('F530'),
  p: luminariRgbToAnsi('F301'),
  P: luminariRgbToAnsi('F413'),
  s: luminariRgbToAnsi('F300'),
  S: luminariRgbToAnsi('F411'),
  t: luminariRgbToAnsi('F320'),
  T: luminariRgbToAnsi('F431'),
  v: luminariRgbToAnsi('F104'),
  V: luminariRgbToAnsi('F215'),
  _: '\u001b[4m',
  '+': '\u001b[1m',
  '-': '\u001b[5m',
  '=': '\u001b[7m',
  '*': '@',
};

type AnsiConverter = {
  toHtml(data: string): string;
};

export function createMudHtmlStreamConverter(): AnsiConverter {
  return new AnsiToHtml({
    escapeXML: true,
    newline: true,
    stream: true,
  });
}

export function renderMudStreamHtml(value: string, converter: AnsiConverter) {
  return converter.toHtml(convertLuminariColorCodes(value));
}

export function renderMudHtml(value: string) {
  return new AnsiToHtml({ escapeXML: true }).toHtml(convertLuminariColorCodes(value));
}

export function convertLuminariColorCodes(value: string) {
  let converted = '';

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current !== LUMINARI_COLOR_CHAR) {
      converted += current;
      continue;
    }

    const next = value[index + 1];
    if (!next) {
      converted += current;
      continue;
    }

    if (next === LUMINARI_COLOR_CHAR) {
      converted += LUMINARI_COLOR_CHAR;
      index += 1;
      continue;
    }

    if (next === '[') {
      const endIndex = value.indexOf(']', index + 2);
      if (endIndex > index + 2) {
        const luminariRgb = value.slice(index + 2, endIndex);
        const ansiColor = luminariRgbToAnsi(luminariRgb);
        if (ansiColor) {
          converted += ansiColor;
          index = endIndex;
          continue;
        }
      }
    }

    const luminariColor = LUMINARI_COLOR_CODES[next];
    if (luminariColor !== undefined) {
      converted += luminariColor;
      index += 1;
      continue;
    }

    converted += current;
  }

  return converted;
}

export function luminariRgbToAnsi(code: string) {
  if (!/^[FfBb][0-5]{3}$/.test(code)) {
    return '';
  }

  const isBackground = code[0].toLowerCase() === 'b';
  const [red, green, blue] = code
    .slice(1)
    .split('')
    .map((value) => Number(value) * 51);

  return `\u001b[${isBackground ? 48 : 38};2;${red};${green};${blue}m`;
}
