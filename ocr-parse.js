/* สมุดปิดกะ — แปลงข้อความ OCR จากหน้าจอปิดกะ POS และสลิปโอนเงิน ให้เป็นข้อมูล
   ทำงานในเครื่องทั้งหมด ไม่ส่งข้อมูลออกไปไหน
   ใช้ทั้งลำดับแถวของหน้าจอ POS (ตายตัว) และการเทียบชื่อหัวข้อแบบคลาดเคลื่อนได้ เพื่อให้ตัวเลขถูกแม้ OCR อ่านภาษาไทยเพี้ยน */
(function (root) {
  "use strict";
  const MONEY = /-?\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)|-?\d+\.\d{2}(?!\d)/g;
  const DTRE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+(\d{1,2})\s*[:.]\s*(\d{2})/;
  const toNum = s => { const n = Number(String(s).replace(/,/g, "")); return isFinite(n) ? n : null; };
  const pad = n => String(n).padStart(2, "0");
  const eq = (a, b) => a != null && b != null && Math.abs(a - b) < 0.015;

  function lev(a, b) {
    a = [...a]; b = [...b]; if (!a.length) return b.length; if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[b.length];
  }
  const letters = s => (s || "").toLowerCase().replace(/[^a-z฀-๿]/g, "");
  const sim = (a, b) => { a = letters(a); b = letters(b); if (!a || !b) return 0; return 1 - lev(a, b) / Math.max([...a].length, [...b].length); };

  function parseDT(s) {
    const m = DTRE.exec(s || ""); if (!m) return null;
    let y = +m[3]; if (y > 2400) y -= 543;
    const d = +m[1], mo = +m[2], h = +m[4], mi = +m[5];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
  }
  const moneyIn = line => (line.match(MONEY) || []).map(toNum);
  const lastInt = line => { const m = line.replace(MONEY, " ").match(/\d+/g); return m ? +m[m.length - 1] : null; };

  const LABELS = {
    openingCash: ["เงินสดเริ่มต้นเปิดกะ"], cashSales: ["ยอดชำระเงินสด"], cashIn: ["เงินเข้า"], cashOut: ["เงินออก"],
    netInOut: ["เงินสดเข้าออกระหว่างกะ"], expectedCash: ["เงินที่คาดไว้", "เงินสดรวมที่คาดไว้"], countedCash: ["เงินสดที่นับได้จริง"],
    overShort: ["ยอดเงินขาดเกิน"], withdrawn: ["เงินสดที่ถอนออก"], remaining: ["ยอดเงินสดคงเหลือในเครื่อง"],
    productSales: ["ยอดขายสินค้า"], discount: ["ส่วนลด"], penalty: ["ค่าปรับ"], serviceCharge: ["servicecharge"], vat: ["ภาษีมูลค่าเพิ่ม"],
    tip: ["ทิป"], cardFee: ["ค่าธรรมเนียมบัตร"], rounding: ["รวมปัดเศษ"], totalRevenue: ["รายได้รวม", "ยอดเงินที่ได้รับ"],
    receipts: ["ใบเสร็จปกติ"], cancelledReceipts: ["ใบเสร็จที่ถูกยกเลิก"], customers: ["จำนวนลูกค้าทั้งหมด"], perHead: ["ยอดขายต่อหัว"],
    totalReceipts: ["จำนวนใบเสร็จทั้งหมด"], perReceipt: ["ยอดขายต่อใบเสร็จ"], totalReceived: ["รวมเงินที่รับมา"], tipDeducted: ["หักทิปไม่นับเป็นยอดขาย"], grandTotal: ["ทั้งหมด"],
  };
  function bestLabel(text, keys) {
    let best = null, bs = 0;
    for (const k of keys) for (const l of LABELS[k]) { const s = sim(text, l); if (s > bs) { bs = s; best = k; } }
    return bs >= 0.62 ? best : null;
  }
  /* assign values of money lines to fields: by label when the OCR text reads well, else by the POS's fixed row order */
  function assign(lines, order, out, intKeys = []) {
    const vals = lines.map(l => intKeys.length ? null : moneyIn(l.t).pop());
    const byLabel = {};
    lines.forEach((l, i) => { const k = bestLabel(l.t.replace(MONEY, ""), order); if (k && !(k in byLabel)) byLabel[k] = i; });
    const labelHits = Object.keys(byLabel).length;
    const usePos = lines.length === order.length && labelHits < order.length * 0.6;
    order.forEach((k, i) => {
      const idx = usePos ? i : (byLabel[k] ?? (lines.length === order.length ? i : null));
      if (idx == null || !lines[idx]) return;
      const v = intKeys.includes(k) ? lastInt(lines[idx].t) : (moneyIn(lines[idx].t).pop() ?? null);
      if (v != null && out[k] == null) out[k] = v;
    });
  }

  const NAME_STOP = new Set(["Service", "Summary", "Thai", "Charge"]);
  function findName(text) {
    const c = {}; (text.match(/\b[A-Z][a-z]{3,}\b/g) || []).forEach(w => { if (!NAME_STOP.has(w)) c[w] = (c[w] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  function parseShift(texts) {
    const out = {}, moves = [], payments = [];
    for (const raw of texts) {
      const lines = raw.split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(t => ({ t }));
      const all = lines.map(l => l.t).join("\n");
      const nm = /(?:เปิดแล้ว|ปิดกะโดย)\s*:?\s*([A-Za-z][A-Za-z.\-]{2,})/.exec(all); if (nm && !out.closedBy) out.closedBy = nm[1];
      const sn = /(?:กะที่|จำนวนกะ[^\d\n]*)\D{0,4}(\d{1,2})\b/.exec(all); if (sn && !out.shiftNo) out.shiftNo = sn[1];
      const sumIdx = lines.findIndex(l => /summary|สรุปยอดเงิน/i.test(l.t) && !moneyIn(l.t).length);
      const body = sumIdx >= 0 ? lines.slice(0, sumIdx) : lines;
      const summary = sumIdx >= 0 ? lines.slice(sumIdx + 1) : [];
      // datetimes in header (lines with a date but no money, before any movement)
      const dtLines = [];
      // movements: a money line followed within 2 lines by a datetime line
      const used = new Set();
      body.forEach((l, i) => {
        if (!moneyIn(l.t).length || parseDT(l.t)) return;
        let j = -1; for (let k = i + 1; k <= i + 3 && k < body.length; k++) { if (moneyIn(body[k].t).length && !parseDT(body[k].t)) break; if (parseDT(body[k].t)) { j = k; break; } }
        if (j < 0) return;
        const amount = moneyIn(l.t).pop(), time = parseDT(body[j].t);
        let type = /เข้า/.test(l.t) ? "in" : /ออก/.test(l.t) ? "out" : null;
        let reason = "", by = null;
        for (let k = i + 1; k < j; k++) {
          const t = body[k].t;
          const r = /เหตุผล\s*[:：;]?\s*(.+)$/.exec(t) || /[:：]\s*(.+)$/.exec(t);
          if (r) reason = r[1].trim();
          const b = /โดย\s*([A-Za-z฀-๿.]+)/.exec(t); if (b) by = b[1];
        }
        moves.push({ amount, time, type, reason, by });
        used.add(i); used.add(j);
      });
      body.forEach((l, i) => { if (!used.has(i) && parseDT(l.t) && !moneyIn(l.t).length) dtLines.push({ i, dt: parseDT(l.t), t: l.t }); });
      const headerMoney = body.filter((l, i) => !used.has(i) && moneyIn(l.t).length && !parseDT(l.t) && i < (body.findIndex((x, k) => used.has(k)) >= 0 ? body.findIndex((x, k) => used.has(k)) : body.length));
      const isPopup = dtLines.length >= 2 || headerMoney.some(l => (moneyIn(l.t).pop() || 0) < 0);
      if (isPopup) {
        const open = dtLines.find(d => /เปิด/.test(d.t)) || dtLines[0], close = dtLines.find(d => /ปิด/.test(d.t) && d !== open) || dtLines[1];
        if (open && !out.openedAt) out.openedAt = open.dt; if (close && !out.closedAt) out.closedAt = close.dt;
        assign(headerMoney, ["openingCash", "cashSales", "netInOut", "expectedCash", "countedCash", "overShort", "withdrawn", "remaining"], out);
      } else if (headerMoney.length) {
        if (dtLines[0] && !out.openedAt) out.openedAt = dtLines[0].dt;
        assign(headerMoney, ["openingCash", "cashSales", "cashIn", "cashOut", "expectedCash", "productSales", "discount", "penalty", "serviceCharge", "vat", "tip", "cardFee", "rounding", "totalRevenue"], out);
      }
      if (summary.length) parseSummary(summary, out, payments);
    }
    if (!out.closedBy) out.closedBy = findName(texts.join("\n"));
    // merge movements across images (same amount + time = same item)
    const seen = new Set(), mv = [];
    moves.forEach(m => { const k = `${m.amount}|${m.time}`; if (seen.has(k)) { const ex = mv.find(x => `${x.amount}|${x.time}` === k); if (ex && !ex.reason && m.reason) ex.reason = m.reason; if (ex && !ex.type && m.type) ex.type = m.type; return; } seen.add(k); mv.push({ ...m }); });
    mv.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    // unknown in/out types: use the drawer totals when known
    if (mv.some(m => !m.type)) {
      const cin = out.cashIn ?? (out.netInOut != null && out.cashOut != null ? out.netInOut + out.cashOut : null);
      if (cin) { const hit = mv.find(m => !m.type && eq(m.amount, cin)); if (hit) hit.type = "in"; }
      mv.forEach(m => { if (!m.type) m.type = "out"; });
    }
    if (mv.length) {
      const sIn = mv.filter(m => m.type === "in").reduce((t, m) => t + m.amount, 0), sOut = mv.filter(m => m.type === "out").reduce((t, m) => t + m.amount, 0);
      if (out.cashIn == null) out.cashIn = +sIn.toFixed(2);
      if (out.cashOut == null) out.cashOut = +sOut.toFixed(2);
    }
    // payments: name the cash line by matching cash sales
    if (payments.length) {
      payments.forEach(p => {
        const n = letters(p.method);
        const known = [["เงินสด", "เงินสด"], ["พร้อมเพย์", "พร้อมเพย์"], ["โอน", "โอนเงิน"], ["บัตร", "บัตรเครดิต"], ["qr", "QR"]].find(([k]) => n.includes(k) || sim(n, k) > 0.6);
        p.method = known ? known[1] : "";
      });
      if (!payments.some(p => p.method === "เงินสด") && out.cashSales != null) { const c = payments.find(p => eq(p.amount, out.cashSales)); if (c) c.method = "เงินสด"; }
      payments.forEach(p => { if (!p.method) p.method = "พร้อมเพย์/โอน"; });
      out.payments = payments.map(p => ({ method: p.method, amount: p.amount }));
    }
    // derived fields: recompute and fix obvious OCR digit errors
    if (out.totalRevenue != null && out.customers) { const v = +(out.totalRevenue / out.customers).toFixed(2); if (!eq(out.perHead, v)) out.perHead = v; }
    if (out.totalRevenue != null && out.receipts) { const v = +(out.totalRevenue / out.receipts).toFixed(2); if (!eq(out.perReceipt, v)) out.perReceipt = v; }
    if (out.countedCash != null && out.expectedCash != null && out.overShort == null) out.overShort = +(out.countedCash - out.expectedCash).toFixed(2);
    if (out.totalRevenue == null && out.grandTotal != null) out.totalRevenue = out.grandTotal;
    delete out.netInOut; delete out.grandTotal; delete out.totalReceived;
    out.movements = mv.map(({ type, amount, reason, time, by }) => ({ type, amount, reason, time, by }));
    return out;
  }

  function parseSummary(lines, out, payments) {
    const statKeys = ["totalRevenue", "receipts", "cancelledReceipts", "customers", "perHead", "totalReceipts", "perReceipt"];
    const ints = ["receipts", "cancelledReceipts", "customers", "totalReceipts"];
    const numeric = lines.filter(l => moneyIn(l.t).length || lastInt(l.t) != null);
    const stats = numeric.slice(0, 7);
    // labels first, then fixed order
    const got = {};
    stats.forEach((l, i) => { const k = bestLabel(l.t.replace(MONEY, "").replace(/\d+/g, ""), statKeys); if (k && !(k in got)) got[k] = i; });
    statKeys.forEach((k, i) => { const idx = got[k] ?? i; const l = stats[idx]; if (!l) return; const v = ints.includes(k) ? lastInt(l.t) : moneyIn(l.t).pop(); if (v != null && out[k] == null) out[k] = v; });
    const rest = lines.slice(lines.indexOf(stats[stats.length - 1]) + 1).filter(l => moneyIn(l.t).length);
    const vals = rest.map(l => moneyIn(l.t).pop());
    // payments are the first k lines whose sum equals the next line (รวมเงินที่รับมา)
    for (let k = 1; k < vals.length; k++) {
      const s = vals.slice(0, k).reduce((t, v) => t + v, 0);
      if (eq(s, vals[k])) {
        rest.slice(0, k).forEach(l => payments.push({ method: l.t.replace(MONEY, "").replace(/^\W*\d{1,2}\s*[.,]\s*/, ""), amount: moneyIn(l.t).pop() }));
        out.totalReceived = vals[k];
        if (vals[k + 1] != null && out.tipDeducted == null) out.tipDeducted = vals[k + 1];
        if (vals[k + 2] != null) out.grandTotal = vals[k + 2];
        if (vals[k + 3] != null && out.discount == null) out.discount = vals[k + 3];
        if (vals[k + 4] != null && out.penalty == null) out.penalty = vals[k + 4];
        break;
      }
    }
  }

  /* ---------- transfer slips ---------- */
  const TH_MON = { "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
    "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4, "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8, "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function slipTime(text) {
    const t = text.replace(/\s+/g, " ");
    const iso = parseDT(t); if (iso) return iso;
    const monKeys = Object.keys(TH_MON).sort((a, b) => b.length - a.length).map(k => k.replace(/\./g, "\\.?")).join("|");
    const re = new RegExp(`(\\d{1,2})\\s*(${monKeys})\\s*(\\d{2,4})[^\\d]{0,8}(\\d{1,2})\\s*[:.]\\s*(\\d{2})`, "i");
    const m = re.exec(t); if (!m) return null;
    const key = Object.keys(TH_MON).find(k => k.replace(/\./g, "").toLowerCase() === m[2].replace(/\./g, "").toLowerCase());
    let y = +m[3]; if (y < 100) y = y > 50 ? 2500 + y - 543 : 2000 + y; else if (y > 2400) y -= 543;
    return `${y}-${pad(TH_MON[key])}-${pad(+m[1])}T${pad(+m[4])}:${m[5]}`;
  }
  function parseSlip(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let amount = null;
    for (let i = 0; i < lines.length && amount == null; i++) {
      if (/จำนวนเงิน|จำนวน|amount|ยอดเงิน|โอนเงินสำเร็จ/i.test(lines[i])) { const v = moneyIn(lines[i]).concat(moneyIn(lines[i + 1] || ""))[0]; if (v != null && v > 0) amount = v; }
    }
    if (amount == null) { const withBaht = lines.filter(l => /บาท|thb|฿/i.test(l)).flatMap(moneyIn).filter(v => v > 0); amount = withBaht.length ? Math.max(...withBaht) : null; }
    if (amount == null) { const all = lines.flatMap(moneyIn).filter(v => v > 0); amount = all.length ? Math.max(...all) : null; }
    let ref = null;
    for (let i = 0; i < lines.length && !ref; i++) if (/เลขที่รายการ|รหัสอ้างอิง|เลขอ้างอิง|ref/i.test(lines[i])) { const m = (lines[i] + " " + (lines[i + 1] || "")).match(/[A-Za-z0-9]{10,}/); if (m) ref = m[0]; }
    if (!ref) { const c = text.match(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{14,}\b/g); if (c) ref = c.sort((a, b) => b.length - a.length)[0]; }
    const bank = (/(กสิกร|K\+|KBank|ไทยพาณิชย์|SCB|กรุงเทพ|Bangkok Bank|กรุงไทย|Krungthai|กรุงศรี|Krungsri|ทหารไทย|ttb|ออมสิน|GSB|ธ\.ก\.ส|BAAC|TrueMoney|ซีไอเอ็มบี|CIMB|ยูโอบี|UOB|แลนด์|LH Bank|เกียรตินาคิน|KKP)/i.exec(text) || [])[1] || null;
    return { amount, time: slipTime(text), ref, bank, sender: null, receiver: null };
  }

  const api = { parseShift, parseSlip, parseDT, slipTime, sim, lev };
  if (typeof module === "object" && module.exports) module.exports = api; else root.ShiftOCR = api;
})(typeof window !== "undefined" ? window : globalThis);
