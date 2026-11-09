// Turns a PDF into lines of text, keeping the left-to-right layout
// (cells far apart are joined with "  ", like `pdftotext -layout`).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Some insurer PDFs (e.g. MSIG) use a font whose digits come out as
// Latin Extended letters. This maps them back.
const GLYPHS = { 'Ŗ': '0', 'ŗ': '1', 'Ř': '2', 'ř': '3', 'Ś': '4', 'ś': '5', 'Ŝ': '6', 'ŝ': '7', 'Ş': '8', 'ş': '9',
  'ǯ': '.', 'ǰ': ',', 'Ǳ': ':', 'ǻ': '(', 'Ǽ': ')', 'Ȭ': '-', 'Ȧ': '/', 'Ɩ': '%', 'ȱ': ' ' };
const fixGlyphs = (s) => s.replace(/[ŖŗŘřŚśŜŝŞşǯǰǱǻǼȬȦƖȱ]/g, (c) => GLYPHS[c]);

export async function pdfLines(data) {
  const doc = await getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, cells: [] }; rows.push(row); }
      row.cells.push({ x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.cells.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const c of r.cells) {
        if (end !== null) line += c.x - end > 6 ? '  ' : (c.x - end > 0.8 ? ' ' : '');
        line += c.s;
        end = c.x + c.w;
      }
      pages.push(fixGlyphs(line).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/[ \t]+$/g, ''));
    }
  }
  return pages;
}
