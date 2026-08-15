// Cells between the two halves. Letters inside a half sit 1 cell apart, so this
// has to be wider than that or "arcus code" renders as the single word
// "arcuscode". Every renderer that draws left beside right must use it.
export const gap = 3

// Each glyph is 4 cells wide with a single-cell gutter, so a row is
// 5*4 + 4 = 24 cells for "arcus" and 4*4 + 3 = 19 for "code". The first row
// carries ascenders only (the "d" in code). Keep every row in a half padded to
// its exact width — Logo() renders the two halves side by side and ragged rows
// shift the bright half out of alignment.
export const logo = {
  left: [
    // The "A" is a capital: apex (▄▀▀▄), ^ crossbar, then legs that open at the
    // baseline (▀  ▀). All three matter — a closed base reads as "B", and
    // dropping the crossbar reads as "n". The legs stay half-height so they sit
    // on the same baseline as the lowercase letters instead of descending.
    "                        ",
    "▄▀▀▄ █▀▀▄ █▀▀▀ █__█ █▀▀▀",
    "█^^█ █___ █___ █__█ ▀▀▀█",
    "▀  ▀ ▀~~~ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
  ],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
