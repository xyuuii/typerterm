// Minimal PDF 1.4 writer: one full-bleed JPEG image per page (DCTDecode).
// Pure byte assembly, usable in the browser and in Node tests.

const enc = new TextEncoder();

/**
 * pages: [{jpeg: Uint8Array, width: px, height: px, pageWidth: pt, pageHeight: pt}]
 * Returns a Uint8Array containing the PDF file.
 */
export function buildPdf(pages, {title = 'INK typewriter pages', producer = 'INK typewriter'} = {}) {
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = data => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const part of [].concat(body)) push(part);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));   // binary marker comment
  // Object ids: 1 catalog, 2 pages, 3 info, then 3 per page.
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfString(title)} /Producer ${pdfString(producer)} /CreationDate ${pdfString(pdfDate(new Date()))} >>`);
  pages.forEach((p, i) => {
    const pageId = 4 + i * 3, contentId = pageId + 1, imageId = pageId + 2;
    const w = num(p.pageWidth), h = num(p.pageHeight);
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(contentId, [`<< /Length ${enc.encode(content).length} >>\nstream\n`, content, '\nendstream']);
    object(imageId, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const num = v => (Math.round(v * 100) / 100).toString();
function pdfString(s) {
  // ASCII-only literal; anything else is written as UTF-16BE hex.
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, m => '\\' + m)})`;
  let hex = 'FEFF';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += code.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}
function pdfDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Browser helper: canvases → PDF Blob. */
export async function canvasesToPdf(items, options) {
  const pages = [];
  for (const {canvas, pageWidth, pageHeight} of items) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    pages.push({jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, pageWidth, pageHeight});
  }
  return new Blob([buildPdf(pages, options)], {type: 'application/pdf'});
}
