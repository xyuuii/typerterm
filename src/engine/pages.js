// Maps the xterm normal buffer onto sheets of paper. xterm stays the only
// source of terminal state; this module only reads it.
//
// A sheet shows `rows` consecutive buffer lines starting at pageTop (tracked
// with an xterm marker so scrollback trimming cannot shift it). When the
// cursor moves past the last row the page is complete: its cells are copied
// (plain records, never xterm objects) into the archive.
import {readCell} from './ink.js';

let pageSeq = 0;

export class PageTracker {
  constructor(term, layout, {paperColor, onArchive}) {
    this.term = term;
    this.layout = layout;
    this.paperColor = paperColor;
    this.onArchive = onArchive;
    this.archive = [];
    this.maxArchive = 300;
    this.marker = null;
    this.pageTop = 0;
    this.cell = null;
  }
  get cols() { return this.layout.cols; }
  get rows() { return this.layout.rows; }
  get pageNumber() { return this.archive.length + 1; }
  setLayout(layout) { this.layout = layout; }
  cursorAbs() {
    const b = this.term.buffer.active;
    return b.baseY + b.cursorY;
  }
  /** Starts the current sheet at the cursor's line. */
  startAtCursor() { this.setTop(this.cursorAbs()); }
  setTop(abs) {
    this.marker?.dispose();
    const offset = abs - this.cursorAbs();
    this.marker = this.term.registerMarker(offset);
    this.pageTop = abs;
  }
  refreshTop() {
    if (this.marker && !this.marker.isDisposed) this.pageTop = this.marker.line;
    else {
      // Our line was trimmed from scrollback or cleared (e.g. ESC[3J).
      const b = this.term.buffer.normal;
      this.setTop(Math.min(this.cursorAbs(), b.baseY));
    }
    return this.pageTop;
  }
  /** Called after xterm has parsed new data. Returns how many pages completed. */
  check() {
    const b = this.term.buffer.active;
    if (b.type !== 'normal') return 0;
    this.refreshTop();
    const cur = this.cursorAbs();
    let done = 0;
    while (cur >= this.pageTop + this.rows) {
      this.archivePage(this.pageTop, this.rows, 'full');
      this.currentSeed = undefined;   // later pages in a burst were never on screen
      this.pageTop += this.rows;
      done++;
    }
    if (done) this.setTop(this.pageTop);
    return done;
  }
  /** Ends the current sheet early (new sheet, clear screen, format change). */
  breakPage(reason) {
    const b = this.term.buffer.normal;
    this.refreshTop();
    const cur = b.baseY + b.cursorY;
    // Lines above the cursor belong to the old sheet; the cursor line moves on.
    const count = Math.max(0, Math.min(this.rows, cur - this.pageTop));
    const page = count > 0 ? this.archivePage(this.pageTop, count, reason) : null;
    this.startAtCursor();
    return page;
  }
  /** Archive the full visible sheet as it is right now (before a clear). */
  archiveVisible(reason) {
    this.refreshTop();
    return this.archivePage(this.pageTop, this.rows, reason);
  }
  archivePage(top, count, reason) {
    const b = this.term.buffer.normal;
    this.cell ??= b.getNullCell();
    const rows = [];
    let any = false;
    for (let r = 0; r < this.rows; r++) {
      const out = [];
      if (r < count) {
        const line = b.getLine(top + r);
        if (line) {
          for (let c = 0; c < this.cols; c++) {
            const cell = line.getCell(c, this.cell);
            if (!cell) continue;
            const rec = readCell(cell);
            if (rec) { out.push([c, rec]); any = true; }
          }
        }
      }
      rows.push(out);
    }
    if (!any) return null;
    const page = {
      id: `p${Date.now().toString(36)}${(pageSeq++).toString(36)}`,
      number: this.archive.length + 1,
      format: this.layout.format,
      paperColor: this.paperColor,
      seed: this.currentSeed ?? ((Math.random() * 1e9) | 0),
      rows,
      reason,
      createdAt: new Date().toISOString(),
    };
    this.archive.push(page);
    if (this.archive.length > this.maxArchive) this.archive.shift();
    this.onArchive?.(page);
    return page;
  }
  /** Current sheet as a flat grid of records (rows × cols). */
  readGrid(alt = false) {
    const b = this.term.buffer.active;
    const {rows, cols} = this;
    const grid = new Array(rows * cols).fill(null);
    this.cell ??= b.getNullCell();
    const top = alt ? b.baseY : this.pageTop;
    for (let r = 0; r < rows; r++) {
      const line = b.getLine(top + r);
      if (!line) continue;
      for (let c = 0; c < cols; c++) {
        const cell = line.getCell(c, this.cell);
        if (cell) grid[r * cols + c] = readCell(cell);
      }
    }
    return grid;
  }
  /** Cursor position relative to the sheet, or null when it is elsewhere. */
  cursorOnPage(alt = false) {
    const b = this.term.buffer.active;
    const r = alt ? b.cursorY : b.baseY + b.cursorY - this.pageTop;
    if (r < 0 || r >= this.rows) return null;
    return {r, c: Math.min(b.cursorX, this.cols - 1), atEnd: b.cursorX >= this.cols};
  }
  /** Current sheet as an archive-shaped object (for PDF of the page in progress). */
  currentAsPage() {
    const grid = this.readGrid(false);
    const rows = [];
    for (let r = 0; r < this.rows; r++) {
      const out = [];
      for (let c = 0; c < this.cols; c++) { const rec = grid[r * this.cols + c]; if (rec) out.push([c, rec]); }
      rows.push(out);
    }
    return {id: 'current', number: this.pageNumber, format: this.layout.format, paperColor: this.paperColor, seed: 7, rows, createdAt: new Date().toISOString()};
  }
  dispose() { this.marker?.dispose(); }
}
