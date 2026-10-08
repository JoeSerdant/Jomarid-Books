import test from 'node:test';
import assert from 'node:assert/strict';
import { readTextFile, decodeTextBytes, mergeImported, MAX_IMPORT_BYTES } from '../bookText/importText.js';

const file = (name, bytes, type = 'text/plain') => ({ name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const utf8 = (s) => new TextEncoder().encode(s);
const cp1250 = (arr) => Uint8Array.from(arr);

test('UTF-8 projde beze změny (CRLF, emoji), BOM na začátku se zahodí', async () => {
  const text = 'Příběh\r\n\r\nŽlutý kůň 😀';
  assert.equal((await readTextFile(file('a.txt', utf8(text)))).text, text);
  const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('Ahoj')]);
  assert.equal((await readTextFile(file('a.txt', withBom))).text, 'Ahoj');
});

test('Windows-1250 se pozná a čeština se zobrazí správně', () => {
  // "Příliš žluťoučký kůň" v cp1250: ř=0xF8 í=0xED š=0x9A ž=0x9E ť=0x9D č=0xE8 ý=0xFD ů=0xF9 ú=0xFA
  const bytes = cp1250([0x50, 0xF8, 0xED, 0x6C, 0x69, 0x9A, 0x20, 0x9E, 0x6C, 0x75, 0x9D, 0x6F, 0x75, 0xE8, 0x6B, 0xFD, 0x20, 0x6B, 0xF9, 0xF2]);
  const r = decodeTextBytes(bytes.buffer);
  assert.equal(r.encoding, 'windows-1250');
  assert.equal(r.text, 'Příliš žluťoučký kůň');
});

test('UTF-16 s BOM se přečte', () => {
  const le = Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
  assert.equal(decodeTextBytes(le.buffer).text, 'AB');
  const be = Uint8Array.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]);
  assert.equal(decodeTextBytes(be.buffer).text, 'AB');
});

test('Word, PDF a e-knihy se odmítnou s návodem', async () => {
  for (const n of ['kniha.docx', 'kniha.pdf', 'kniha.epub', 'kniha.rtf']) {
    const r = await readTextFile(file(n, utf8('x'), 'application/octet-stream'));
    assert.match(r.error, /prostý text|\.txt/);
  }
});

test('binární soubor, prázdný soubor, příliš velký soubor, neznámý typ', async () => {
  assert.match((await readTextFile(file('a.txt', Uint8Array.from([0x50, 0x4b, 0x00, 0x04])))).error, /binární/);
  assert.match((await readTextFile(file('a.txt', utf8('  \n ')))).error, /prázdný/);
  assert.match((await readTextFile({ ...file('a.txt', utf8('x')), size: MAX_IMPORT_BYTES + 1 })).error, /velký/);
  assert.match((await readTextFile(file('a.bin', utf8('x'), 'image/png'))).error, /textové/);
  assert.ok((await readTextFile(file('kniha', utf8('Text'), 'text/plain'))).text); // bez přípony, ale text/plain
  assert.ok((await readTextFile(file('kniha.TXT', utf8('Text'), ''))).text); // typ prohlížeč neurčil
  assert.match((await readTextFile(null)).error, /načíst/);
});

test('spojení s existujícím textem: nahradit nebo připojit', () => {
  assert.equal(mergeImported('starý', 'nový', 'replace'), 'nový');
  assert.equal(mergeImported('starý  \n', 'nový', 'append'), 'starý\n\nnový');
  assert.equal(mergeImported('   ', 'nový', 'append'), 'nový');
});
