// Gerador de planilha .xlsx SEM dependências (Node puro).
// Monta um ZIP (método STORE) com o mínimo de XML que o Excel/Google Sheets abrem.

// ---- CRC32 ----
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// ---- ZIP (STORE, sem compressão) ----
function zip(files) {
  const locals = []; const central = []; let offset = 0;
  const dosTime = 0, dosDate = 0x21; // 1980-01-01
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += lh.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---- helpers XML ----
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function colLetter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

// Monta o .xlsx. headers = ['Col A',...]; rows = [[v,v,...],...]
// opts.moneyCols = índices de colunas monetárias (número, formato R$)
function build(headers, rows, opts = {}) {
  const money = new Set(opts.moneyCols || []);
  const sheetName = (opts.sheetName || 'Vendas').slice(0, 31);
  const cell = (c, r, val, styleHeader) => {
    const ref = colLetter(c) + r;
    if (styleHeader) return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
    if (money.has(c) && val !== '' && val != null && !isNaN(+val)) return `<c r="${ref}" s="2"><v>${(+val)}</v></c>`;
    if (typeof val === 'number' && !isNaN(val)) return `<c r="${ref}"><v>${val}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
  };
  let sd = '';
  sd += `<row r="1">` + headers.map((h, c) => cell(c, 1, h, true)).join('') + `</row>`;
  rows.forEach((row, ri) => {
    const r = ri + 2;
    sd += `<row r="${r}">` + row.map((v, c) => cell(c, r, v, false)).join('') + `</row>`;
  });
  const lastCol = colLetter(Math.max(1, headers.length) - 1);
  const dim = `A1:${lastCol}${rows.length + 1}`;
  const cols = headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${(opts.widths && opts.widths[i]) || 16}" customWidth="1"/>`).join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sd}</sheetData><autoFilter ref="${dim}"/></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$ &quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8551A"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  return zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ]);
}

// ================= LEITURA de .xlsx =================
const zlib = require('zlib');
function unesc(s) { return String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&'); }
function colIndex(ref) { const m = String(ref).match(/^([A-Z]+)/); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
// abre o ZIP pelo diretório central e devolve { nome: Buffer }
function unzip(buf) {
  const files = {};
  // acha o End Of Central Directory
  let eo = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error('Arquivo .xlsx inválido');
  let cd = buf.readUInt32LE(eo + 16); const total = buf.readUInt16LE(eo + 10);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const fnLen = buf.readUInt16LE(cd + 28), exLen = buf.readUInt16LE(cd + 30), cmLen = buf.readUInt16LE(cd + 32);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + fnLen);
    // vai ao local header p/ achar o início real dos dados
    const lfn = buf.readUInt16LE(lho + 26), lex = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lfn + lex;
    const raw = buf.slice(start, start + compSize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    cd += 46 + fnLen + exLen + cmLen;
  }
  return files;
}
// lê a primeira planilha e devolve linhas (array de arrays de strings)
function read(buf) {
  const files = unzip(buf);
  const dec = b => b ? b.toString('utf8') : '';
  // sharedStrings
  const shared = [];
  const ss = dec(files['xl/sharedStrings.xml']);
  if (ss) { const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(ss))) { const parts = []; const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let tm; while ((tm = tre.exec(m[1]))) parts.push(unesc(tm[1])); shared.push(parts.join('')); } }
  // acha o xml da 1ª planilha
  let sheetXml = dec(files['xl/worksheets/sheet1.xml']);
  if (!sheetXml) { const k = Object.keys(files).find(n => /^xl\/worksheets\/.*\.xml$/.test(n)); if (k) sheetXml = dec(files[k]); }
  if (!sheetXml) throw new Error('Planilha vazia');
  const rows = [];
  const rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rre.exec(sheetXml))) {
    const cells = [];
    const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cre.exec(rm[1]))) {
      const attrs = cm[1] || ''; const inner = cm[2] || '';
      const refM = attrs.match(/r="([A-Z]+\d+)"/); const ci = refM ? colIndex(refM[1]) : cells.length;
      const tM = attrs.match(/t="([^"]+)"/); const t = tM ? tM[1] : '';
      let val = '';
      if (t === 'inlineStr') { const im = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/); val = im ? unesc(im[1]) : ''; }
      else { const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/); const raw = vm ? vm[1] : ''; val = t === 's' ? (shared[+raw] || '') : unesc(raw); }
      cells[ci] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

module.exports = { build, read };
