/**
 * Public entry point for the quoted-printable library.
 *
 * Re-exports the encoder and decoder so callers can do:
 *   import { QuotedPrintable } from 'quoted-printable-encoder';
 */
export { encode, decode } from './core.js';
