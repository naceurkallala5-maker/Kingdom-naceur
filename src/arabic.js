// Guards for the Arabic-only rule (see CLAUDE.md, section 1).
// Any text shown to the owner must contain no Latin letters.

const LATIN = /[A-Za-z]/;
const ARABIC_LETTER = /[؀-ۿ]/;

export function containsLatin(text) {
  return LATIN.test(String(text ?? ''));
}

export function isArabicText(text) {
  const value = String(text ?? '').trim();
  return value.length > 0 && ARABIC_LETTER.test(value) && !containsLatin(value);
}

/** Throws a coded error when a user-facing field is not Arabic. */
export function requireArabic(fields) {
  for (const [field, value] of Object.entries(fields)) {
    if (!isArabicText(value)) {
      const err = new Error(`non_arabic_field:${field}`);
      err.code = 'non_arabic_field';
      err.field = field;
      throw err;
    }
  }
}
