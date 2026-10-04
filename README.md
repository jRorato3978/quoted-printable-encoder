# Quoted-Printable Encoder

A small, zero-dependency TypeScript-free JavaScript (ESM) library that encodes
and decodes [quoted-printable](https://www.rfc-editor.org/rfc/rfc2045#section-6.7)
format as specified in RFC 2045, Section 6.7, for MIME email content.

## Usage

```js
import { encode, decode } from 'quoted-printable-encoder';

const encoded = encode('Café — déjà vu');
// "Caf=C3=A9 =E2=80=94 d=C3=A9j=C3=A0 vu"

const plain = decode(encoded);
// "Café — déjà vu"
```

Both functions are exported from `src/index.js` and re-exported from
`src/core.js`. `encode(input: string): string` takes a JavaScript string
(UTF-8 internally) and returns the quoted-printable representation with CRLF
line endings. `decode(input: string): string` reverses the transformation and
also normalises line endings in the output to CRLF.

## Why this exists

Quoted-printable is the right encoding for email bodies that are mostly ASCII
but contain a few non-ASCII bytes or bytes that would confuse a mail
transport. Base64 is simpler but makes the body unreadable to humans and to
naïve search; quoted-printable keeps the readable parts readable.

The trade-off this library makes is simplicity over configurability: it only
accepts and produces strings, it always uses UTF-8 for input interpretation,
and it always emits CRLF line endings. It does not support binary input
directly — pass bytes through a `TextDecoder` first if you need that.

## The awkward edge

The single trickiest rule in quoted-printable is the interaction between
**line wrapping** and **`=XX` escapes**: a soft line break (`=CRLF`) must
never split a `=XX` sequence across two physical lines, because a decoder
would see a dangling `=` and misinterpret the following bytes. This encoder
breaks lines *before* whole tokens, so an escape that would overflow the
76-character limit is pushed to the next line intact. If you inspect the
output of a long line you will see breaks in what look like odd places — that
is correct, not a bug.

The other edge worth knowing: **trailing whitespace** on a logical line
(spaces and tabs immediately before a line break or at end of input) is
illegal in quoted-printable because some mail transports strip trailing
whitespace and would corrupt the body. This encoder escapes such bytes as
`=20` / `=09` rather than emitting them literally. Mid-line spaces and tabs
are left literal, as the spec allows.
