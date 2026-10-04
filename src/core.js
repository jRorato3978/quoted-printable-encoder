/**
 * Quoted-printable encoding and decoding per RFC 2045, Section 6.7.
 *
 * The quoted-printable encoding is designed so that text which is mostly
 * ASCII remains readable after encoding, while bytes outside the safe range
 * are represented as `=XX` hex escapes. This module provides the encoder and
 * decoder as pure functions plus a small higher-level wrapper.
 */

/**
 * Maximum line length for quoted-printable output, excluding the trailing CRLF.
 *
 * RFC 2045 Section 6.7 states that no line shall be longer than 76 characters,
 * *not counting* the trailing CRLF. Encoded lines therefore carry at most 76
 * characters of content followed by a soft line break ("=\r\n").
 */
const MAX_LINE_LENGTH = 76;

/**
 * A byte value (0–255) is in the "safe set" if it may be represented
 * literally in quoted-printable output without escaping.
 *
 * Per RFC 2045 Section 6.7, the following may be represented literally:
 *   - Printable ASCII characters in the range 33–126, EXCEPT `=` (61).
 *   - Space (32) and Tab (9), but only when they do not appear at the end of
 *     a line (trailing whitespace is illegal and must be encoded).
 *
 * We do not treat space/tab as universally safe here; the encoder handles the
 * trailing-whitespace rule at the point of emission so that the decision takes
 * line position into account.
 */
function isLiteralSafe(byte) {
  // 33 (`!`) through 126 (`~`), excluding `=` (61).
  return byte >= 33 && byte <= 126 && byte !== 61;
}

/**
 * Encode a single byte into its `=XX` hex representation, uppercase.
 */
function encodeHex(byte) {
  const hex = byte.toString(16).toUpperCase();
  return '=' + (hex.length === 1 ? '0' + hex : hex);
}

/**
 * Convert a string into a Uint8Array of its UTF-8 bytes.
 *
 * `TextEncoder` is the idiomatic Web Platform way to get UTF-8 bytes and is
 * available in Node 18+ and all modern browsers. We do not attempt any other
 * character encoding: quoted-printable is byte-oriented, and the only
 * sensible default for text input in 2024 is UTF-8.
 */
function toUtf8Bytes(text) {
  return new TextEncoder().encode(text);
}

/**
 * Encode a string to quoted-printable format.
 *
 * Rules implemented (RFC 2045 §6.7):
 *   1. Bytes in the literal-safe set are emitted as-is.
 *   2. Space and Tab are emitted literally UNLESS they appear at the end of a
 *      logical line, in which case they are hex-encoded to avoid ambiguity
 *      with trailing whitespace that some mail transports strip.
 *   3. All other bytes become `=XX` (uppercase hex).
 *   4. A logical line break in the input (CR, LF, or CRLF) is emitted as CRLF
 *      and resets the line length counter.
 *   5. Whenever emitting a byte would make the current physical line exceed
 *      76 characters, a soft line break `=CRLF` is emitted first. We split on
 *      `=` escapes whenever possible so that a decoder never sees a partial
 *      `=XX` sequence straddling a line boundary.
 *
 * @param {string} input - The text to encode. Interpreted as UTF-8.
 * @returns {string} The quoted-printable representation, using CRLF line
 *   endings.
 */
export function encode(input) {
  const bytes = toUtf8Bytes(String(input));
  let out = '';
  let lineLen = 0;
  let i = 0;

  /**
   * Append a token to `out`, inserting a soft line break first if it would
   * overflow the current line. We treat the token as atomic: we never split
   * a `=XX` escape across a line boundary. If a single literal token would
   * itself exceed the limit, we break before it.
   */
  function emit(token, len) {
    if (lineLen + len > MAX_LINE_LENGTH) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += token;
    lineLen += len;
  }

  while (i < bytes.length) {
    const byte = bytes[i];

    // Handle line-ending bytes by normalising to CRLF. We must look ahead for
    // the CRLF pair so that a single logical newline only produces one CRLF in
    // the output. Lone CR or LF is also treated as a newline, matching the
    // lenient behaviour most mail stacks expect.
    if (byte === 13) {
      // CR
      out += '\r\n';
      lineLen = 0;
      i += 1;
      if (i < bytes.length && bytes[i] === 10) {
        // LF following CR — consumed as part of the CRLF.
        i += 1;
      }
      continue;
    }
    if (byte === 10) {
      // LF (not preceded by CR)
      out += '\r\n';
      lineLen = 0;
      i += 1;
      continue;
    }

    // Determine whether this byte begins a line-ending run. We treat a
    // trailing space/tab at the end of a logical line (i.e. immediately
    // before a CR/LF or at end of input) as requiring hex encoding.
    const nextByte = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const atLineEnd =
      nextByte === -1 || nextByte === 13 || nextByte === 10;

    if (isLiteralSafe(byte)) {
      emit(String.fromCharCode(byte), 1);
      i += 1;
      continue;
    }

    if ((byte === 32 || byte === 9) && !atLineEnd) {
      // Space or Tab mid-line: literal.
      emit(String.fromCharCode(byte), 1);
      i += 1;
      continue;
    }

    // Everything else (including trailing space/tab) is hex-escaped.
    const token = encodeHex(byte);
    emit(token, 3);
    i += 1;
  }

  return out;
}

/**
 * Decode a quoted-printable string back into a UTF-8 string.
 *
 * Rules implemented (RFC 2045 §6.7):
 *   1. `=XX` where XX is two hex digits is replaced by the corresponding byte.
 *   2. `=` followed by CRLF, LF, or CR is a soft line break and is dropped.
 *   3. Any other `=` that is not followed by two hex digits is a malformed
 *      sequence; we leave it verbatim rather than throwing, because real mail
 *      is messy and throwing on every malformed byte makes the decoder useless
 *      for its primary job.
 *   4. CRLF, CR, and LF in the input are normalised to CRLF in the output to
 *      keep the canonical line-ending form.
 *
 * @param {string} input - The quoted-printable text to decode.
 * @returns {string} The decoded text, with line endings normalised to CRLF.
 */
export function decode(input) {
  const src = String(input);
  const bytes = [];
  let i = 0;

  /**
   * Push a byte onto the output buffer. We accumulate bytes and decode once
   * at the end so that multi-byte UTF-8 sequences are handled correctly by
   * TextDecoder.
   */
  function pushByte(b) {
    bytes.push(b);
  }

  function isHexDigit(c) {
    return (
      (c >= '0' && c <= '9') ||
      (c >= 'A' && c <= 'F') ||
      (c >= 'a' && c <= 'f')
    );
  }

  while (i < src.length) {
    const ch = src[i];

    if (ch === '=') {
      // Soft line break: = followed by CR, LF, or CRLF. Drop the `=` and the
      // line ending entirely; continue the logical line.
      if (i + 1 < src.length && src[i + 1] === '\r') {
        i += 2;
        if (i < src.length && src[i] === '\n') i += 1;
        continue;
      }
      if (i + 1 < src.length && src[i + 1] === '\n') {
        i += 2;
        continue;
      }
      // Hex escape: =XX
      if (
        i + 2 < src.length &&
        isHexDigit(src[i + 1]) &&
        isHexDigit(src[i + 2])
      ) {
        const hex = src.substring(i + 1, i + 3);
        pushByte(parseInt(hex, 16));
        i += 3;
        continue;
      }
      // Malformed `=` with neither a line break nor two hex digits. Leave it
      // verbatim so the caller can see the corrupt data.
      pushByte(61); // '='
      i += 1;
      continue;
    }

    // Normalise CRLF / CR / LF to CRLF.
    if (ch === '\r') {
      pushByte(13);
      pushByte(10);
      i += 1;
      if (i < src.length && src[i] === '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      pushByte(13);
      pushByte(10);
      i += 1;
      continue;
    }

    pushByte(ch.charCodeAt(0));
    i += 1;
  }

  const arr = new Uint8Array(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(arr);
}
