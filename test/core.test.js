import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../src/core.js';

describe('quoted-printable encode', () => {
  it('leaves plain ASCII text untouched', () => {
    assert.equal(encode('Hello, World!'), 'Hello, World!');
  });

  it('escapes the equals sign', () => {
    // `=` itself must be encoded so it is not mistaken for an escape.
    assert.equal(encode('a=b'), 'a=3Db');
  });

  it('encodes a non-ASCII byte as =XX uppercase', () => {
    // U+00E9 (é) is 0xC3 0xA9 in UTF-8.
    assert.equal(encode('é'), '=C3=A9');
  });

  it('encodes trailing space on a line', () => {
    // Trailing whitespace must be escaped; mail transports may strip it.
    assert.equal(encode('hello '), 'hello=20');
  });

  it('leaves mid-line space literal', () => {
    assert.equal(encode('hello world'), 'hello world');
  });

  it('encodes trailing tab on a line', () => {
    assert.equal(encode('a\t'), 'a=09');
  });

  it('encodes a NUL byte', () => {
    assert.equal(encode(String.fromCharCode(0)), '=00');
  });

  it('normalises LF to CRLF in the output', () => {
    assert.equal(encode('line1\nline2'), 'line1\r\nline2');
  });

  it('normalises CRLF to a single CRLF in the output', () => {
    assert.equal(encode('line1\r\nline2'), 'line1\r\nline2');
  });

  it('normalises a lone CR to CRLF', () => {
    assert.equal(encode('a\rb'), 'a\r\nb');
  });

  it('wraps long lines with soft breaks without splitting an =XX escape', () => {
    // 80 literal 'a' characters. Each literal is 1 char; the line must wrap
    // at 76. The wrapped output is 76 a's, soft break, then 4 a's.
    const input = 'a'.repeat(80);
    const expected = 'a'.repeat(76) + '=\r\n' + 'a'.repeat(4);
    assert.equal(encode(input), expected);
  });

  it('wraps before a hex escape that would overflow the line', () => {
    // 75 literal 'a's followed by é (which encodes to =C3=A9, 6 chars).
    // 75 + 6 = 81 > 76, so the escape must go on the next line.
    const input = 'a'.repeat(75) + 'é';
    const expected = 'a'.repeat(75) + '=\r\n=C3=A9';
    assert.equal(encode(input), expected);
  });

  it('fits a hex escape exactly at the line boundary', () => {
    // 73 literal 'a's + é (=C3=A9, 6 chars) = 79 chars... wait, 73 + 6 = 79 > 76.
    // 70 a's + é = 70 + 6 = 76, which fits exactly (76 is the max).
    const input = 'a'.repeat(70) + 'é';
    const expected = 'a'.repeat(70) + '=C3=A9';
    assert.equal(encode(input), expected);
  });
});

describe('quoted-printable decode', () => {
  it('decodes plain ASCII verbatim', () => {
    assert.equal(decode('Hello, World!'), 'Hello, World!');
  });

  it('decodes an =XX escape', () => {
    assert.equal(decode('a=3Db'), 'a=b');
  });

  it('decodes lowercase hex escapes', () => {
    assert.equal(decode('=c3=a9'), 'é');
  });

  it('drops a soft line break', () => {
    assert.equal(decode('line1=\r\nline2'), 'line1line2');
  });

  it('drops a soft line break with LF only', () => {
    assert.equal(decode('line1=\nline2'), 'line1line2');
  });

  it('normalises CRLF in the decoded output', () => {
    assert.equal(decode('line1\r\nline2'), 'line1\r\nline2');
  });

  it('normalises a lone LF to CRLF', () => {
    assert.equal(decode('line1\nline2'), 'line1\r\nline2');
  });

  it('leaves a malformed equals verbatim', () => {
    // `=` not followed by hex or a line break is corrupt; we preserve it.
    assert.equal(decode('a=zb'), 'a=zb');
  });

  it('decodes a =00 NUL byte', () => {
    assert.equal(decode('=00'), String.fromCharCode(0));
  });

  it('round-trips a multi-line ASCII message', () => {
    const original = 'Hello,\r\nWorld!';
    assert.equal(decode(encode(original)), original);
  });

  it('round-trips UTF-8 text', () => {
    const original = 'Café — déjà vu';
    assert.equal(decode(encode(original)), original);
  });

  it('round-trips text with trailing whitespace', () => {
    // Trailing space is encoded as =20 and decodes back to a space.
    const original = 'hello ';
    assert.equal(decode(encode(original)), original);
  });

  it('round-trips a long line that requires wrapping', () => {
    const original = 'a'.repeat(200);
    assert.equal(decode(encode(original)), original);
  });
});
