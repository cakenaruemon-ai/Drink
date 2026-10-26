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
    productSales: ["ยอดขายสินค้า"], discount: ["ส่วนลด"], penalty: ["ค่าปรับ"], serviceCharge: ["servicecharge"], vat: ["ภาษีมูลค่าเพิ่ม", "vat"],
    tip: ["ทิป"], cardFee: ["ค่าธรรมเนียมบัตร"], deliveryFee: ["ค่าจัดส่ง"], rounding: ["รวมปัดเศษ"], totalRevenue: ["รายได้รวม", "ยอดเงินที่ได้รับ"],
    receipts: ["ใบเสร็จปกติ"], cancelledReceipts: ["ใบเสร็จที่ถูกยกเลิก"], customers: ["จำนวนลูกค้าทั้งหมด"], perHead: ["ยอดขายต่อหัว"],
    totalReceipts: ["จำนวนใบเสร็จทั้งหมด"], perReceipt: ["ยอดขายต่อใบเสร็จ"], totalReceived: ["รวมเงินที่รับมา"], tipDeducted: ["หักทิปไม่นับเป็นยอดขาย"], grandTotal: ["ทั้งหมด"],
  };
  function bestLabel(text, keys) {
    let best = null, bs = 0;
    for (const k of keys) for (const l of LABELS[k]) { const s = sim(text, l); if (s > bs) { bs = s; best = k; } }
    return bs >= 0.62 ? best : null;
  }
  /* assign values of money lines to fields: by label when the OCR text reads well, else by the POS's fixed row order */
  /* rough size of each field on this POS: helps place rows when a label is unreadable */
  const BIG = new Set(["openingCash", "cashSales", "expectedCash", "countedCash", "withdrawn", "productSales", "totalRevenue", "totalReceived", "grandTotal"]);
  const SMALL = new Set(["penalty", "vat", "tip", "cardFee", "rounding", "remaining", "overShort", "deliveryFee"]);
  /* align OCR money lines to the POS's fixed row order (tolerates extra / missing / misread lines) */
  function assign(lines, order, out, opt = {}) {
    const n = lines.length, m = order.length; if (!n) return;
    const val = lines.map(l => moneyIn(l.t).pop());
    const score = (i, j) => {
      const k = order[j], s = Math.max(...LABELS[k].map(l => sim(lines[i].t.replace(MONEY, ""), l)));
      let sc = 0.35 + (s >= 0.62 ? 1.2 * s : s >= 0.4 ? 0.3 * s : 0);
      // a confident label for a different key argues against this pairing
      const other = Math.max(0, ...order.filter(x => x !== k).flatMap(x => LABELS[x].map(l => sim(lines[i].t.replace(MONEY, ""), l))));
      if (other >= 0.8 && s < 0.5) sc -= 0.8;
      if (out[k] != null && val[i] != null) sc += eq(val[i], out[k]) ? 1.5 : -0.6;
      if (opt.preferEarly) sc -= 0.02 * j; // on a tie, prefer earlier rows (photos are usually cut off at the bottom)
      const v = Math.abs(val[i] ?? 0);
      if (BIG.has(k)) sc += v >= 1000 ? 0.15 : v < 100 ? -0.2 : 0;
      if (SMALL.has(k)) sc += v < 100 ? 0.1 : v >= 1000 ? -0.25 : 0;
      return sc;
    };
    const SKIP_LINE = -0.3, SKIP_KEY = -0.32;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-Infinity)), bt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    dp[0][0] = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      if (i && j) { const v = dp[i - 1][j - 1] + score(i - 1, j - 1); if (v > dp[i][j]) { dp[i][j] = v; bt[i][j] = 1; } }
      if (i) { const v = dp[i - 1][j] + SKIP_LINE; if (v > dp[i][j]) { dp[i][j] = v; bt[i][j] = 2; } }
      if (j) { const v = dp[i][j - 1] + SKIP_KEY; if (v > dp[i][j]) { dp[i][j] = v; bt[i][j] = 3; } }
    }
    for (let i = n, j = m; i || j;) {
      const t = bt[i][j];
      if (t === 1) { const k = order[j - 1]; if (val[i - 1] != null && out[k] == null) out[k] = val[i - 1]; i--; j--; }
      else if (t === 2) i--; else j--;
    }
  }

  const NAME_STOP = new Set(["Service", "Summary", "Thai", "Charge"]);
  function findName(text) {
    const c = {}; (text.match(/\b[A-Z][a-z]{3,}\b/g) || []).forEach(w => { if (!NAME_STOP.has(w)) c[w] = (c[w] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  function parseShift(texts) {
    const out = {}, moves = [], payments = [], later = [];
    for (const raw of texts) {
      const lines = raw.split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(t => ({ t }));
      const all = lines.map(l => l.t).join("\n");
      const cb = /ปิดกะโดย\s*:?\s*([A-Za-z\u0E00-\u0E7F][A-Za-z\u0E00-\u0E7F.\- ]{1,40}?)\s*$/m.exec(all); if (cb && !out.closedBy) out.closedBy = cb[1].trim();
      const ob = /เปิดแล้ว\s*:?\s*([A-Za-z\u0E00-\u0E7F][A-Za-z\u0E00-\u0E7F.\- ]{1,40}?)\s+\d{1,2}\s*\//.exec(all); if (ob && !out.openedBy) out.openedBy = ob[1].trim();
      if (!out.shiftNo) { const z = lines.slice(0, 3).map(l => /^[^\d]{0,30}[:\s](\d{1,2})\s*$/.exec(l.t)).find(Boolean); if (z) out.shiftNo = z[1]; }
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
        // main page: aligned last, so values from the popup / summary / movements anchor it
        later.push(() => {
          if (dtLines[0] && !out.openedAt) out.openedAt = dtLines[0].dt;
          assign(headerMoney, ["openingCash", "cashSales", "cashIn", "cashOut", "expectedCash", "productSales", "discount", "penalty", "serviceCharge", "vat", "tip", "cardFee", "rounding", "totalRevenue"], out);
        });
      }
      if (summary.length) parseSummary(summary, out, payments);
    }
    if (!out.closedBy) out.closedBy = findName(texts.join("\n"));
    if (out.cashIn == null && out.cashOut == null && moves.some(m => m.type)) {
      const seen0 = new Set(), u = moves.filter(m => { const k = `${m.amount}|${m.time}`; if (seen0.has(k)) return false; seen0.add(k); return true; });
      if (u.every(m => m.type)) { out.cashIn = +u.filter(m => m.type === "in").reduce((t, m) => t + m.amount, 0).toFixed(2); out.cashOut = +u.filter(m => m.type === "out").reduce((t, m) => t + m.amount, 0).toFixed(2); }
    }
    if (out.cashIn != null && out.cashOut == null && out.netInOut != null) out.cashOut = +(out.cashIn - out.netInOut).toFixed(2);
    later.forEach(f => f());
    // merge movements across images (same amount + time = same item)
    const seen = new Set(), mv = [];
    moves.forEach(m => {
      const ex = mv.find(x => x.amount === m.amount && x.time === m.time && (!x.reason || !m.reason || sim(x.reason, m.reason) >= 0.5));
      if (ex) { if ((m.reason || "").length > (ex.reason || "").length) ex.reason = m.reason; if (!ex.type && m.type) ex.type = m.type; return; }
      mv.push({ ...m });
    });
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
    const r2 = v => +v.toFixed(2);
    if (out.expectedCash == null && [out.openingCash, out.cashSales, out.cashIn, out.cashOut].every(v => v != null)) out.expectedCash = r2(out.openingCash + out.cashSales + out.cashIn - out.cashOut);
    if (out.countedCash == null && out.withdrawn != null && out.remaining != null) out.countedCash = r2(out.withdrawn + out.remaining);
    if (out.remaining == null && out.countedCash != null && out.withdrawn != null) out.remaining = r2(out.countedCash - out.withdrawn);
    if (out.receipts != null && out.cancelledReceipts != null && out.totalReceipts !== out.receipts + out.cancelledReceipts) out.totalReceipts = out.receipts + out.cancelledReceipts;
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
    const after = lines.slice(lines.indexOf(stats[stats.length - 1]) + 1);
    // categories ("หมวดหมู่"): "1. name  qty  amount" lines — kept apart so they are never read as payments/fees
    // a category row has a quantity right before its amount: "มิกซ์เซอร์  303  12,330.00"
    const isCat = l => /(?:^|\s)\d{1,4}\s+-?\d{1,3}(?:,\d{3})*\.\d{2}/.test(l.t);
    let catStart = after.findIndex(l => /หมวดหมู่/.test(l.t) && !moneyIn(l.t).length);
    if (catStart < 0) { const f = after.findIndex(isCat); if (f >= 0) catStart = f - 1; }
    const body = catStart >= 0 ? after.slice(0, catStart + 1) : after;
    const cats = catStart >= 0 ? after.slice(catStart + 1).filter(l => moneyIn(l.t).length) : [];
    if (cats.length) out.categories = cats.map(l => { const m = /^\W*(?:\d{1,2}\s*[.,]\s*)?(.*?)\s*(\d{1,4})\s+(-?[\d,]+\.\d{2})/.exec(l.t); return { name: (m ? m[1] : "").replace(/[^A-Za-z\u0E00-\u0E7F ]/g, "").trim(), qty: m ? +m[2] : null, amount: m ? toNum(m[3]) : moneyIn(l.t).pop() }; });
    const rest = body.filter(l => moneyIn(l.t).length);
    const vals = rest.map(l => moneyIn(l.t).pop());
    // payments: the first k lines whose sum equals the next line (รวมเงินที่รับมา / ทั้งหมด)
    for (let k = 1; k < vals.length; k++) {
      const sm = vals.slice(0, k).reduce((t, v) => t + v, 0);
      if (!eq(sm, vals[k])) continue;
      rest.slice(0, k).forEach(l => payments.push({ method: l.t.replace(MONEY, "").replace(/^\W*\d{1,2}\s*[.,]\s*/, ""), amount: moneyIn(l.t).pop() }));
      out.totalReceived = vals[k];
      let j = k + 1;
      // layout A: รวมเงินที่รับมา → หัก ทิป → ทั้งหมด (= รับมา − ทิป). layout B: ทั้งหมด right after payments, no tip line
      if (vals[j] != null && vals[j + 1] != null && eq(vals[k] - vals[j], vals[j + 1])) {
        if (out.tipDeducted == null) out.tipDeducted = vals[j]; out.grandTotal = vals[j + 1]; j += 2;
      } else { if (out.tipDeducted == null) out.tipDeducted = 0; out.grandTotal = vals[k]; }
      // "อื่นๆ": discount, penalty, delivery, service, VAT, tip, card fee — matched by label, aligned by order when labels are unreadable
      assign(rest.slice(j), ["discount", "penalty", "deliveryFee", "serviceCharge", "vat", "tip", "cardFee"], out, { preferEarly: true });
      break;
    }
  }

  /* ---------- transfer slips ---------- */
  const TH_MON = { "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
    "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4, "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8, "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /* ---------- slip helpers ---------- */
  const SLIP_MONEY = /(?<![\d.,])(\d{1,3}(?:[,.]\d{3})*|\d+)[.,](\d{2})(?![\d])/g;
  const monKeyList = Object.keys(TH_MON).sort((a, b) => b.length - a.length);
  function monthOf(tok) {
    const t = (tok || "").replace(/\s/g, "").replace(/\./g, "").toLowerCase(); if (!t) return null;
    const k = monKeyList.find(k => k.replace(/\./g, "").toLowerCase() === t); return k ? TH_MON[k] : null;
  }
  function fixYear(y) { y = +y; if (y < 100) y = y >= 50 ? y + 2500 - 543 : y + 2000; else if (y > 2400) y -= 543; return y >= 2000 && y <= 2100 ? y : null; }
  /* full date when the month is readable; otherwise day + time only (the app fills the month from the shift) */
  function slipTime(text) {
    const t = text.replace(/[ \t]+/g, " ");
    let m = /(?<![\d\/])(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})(?![\d\/])\s*[-–,]?\s*(\d{1,2})\s*[:.]\s*(\d{2})/.exec(t);
    if (m) { const y = fixYear(m[3]); if (y && +m[2] >= 1 && +m[2] <= 12) return { time: `${y}-${pad(+m[2])}-${pad(+m[1])}T${pad(+m[4])}:${m[5]}` }; }
    const re = /(?:^|[^\d])(\d{1,2})\s*([^\d\s:]{1,8}?)\s*(\d{2}|25\d\d|20\d\d)\s*[-–]?\s*(\d{1,2})\s*[:;.]\s*(\d{2})(?![\d])/g;
    let best = null;
    while ((m = re.exec(t))) {
      const d = +m[1], y = fixYear(m[3]), h = +m[4], mi = +m[5];
      if (!y || d < 1 || d > 31 || h > 23 || mi > 59) continue;
      const nowY = new Date().getFullYear(); if (Math.abs(y - nowY) > 1) continue;
      const mo = monthOf(m[2]);
      if (mo) return { time: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}` };
      if (!best) best = { day: d, year: y, hm: `${pad(h)}:${pad(mi)}` };
    }
    if (best) return { timeParts: best };
    // last resort: a camera date stamp such as "2026/10/17 23:57" (photo time, close to the transfer)
    m = /(20\d\d)\s*[\/-]\s*(\d{1,2})\s*[\/-]\s*(\d{1,2})\s+(\d{1,2})\s*:\s*(\d{2})/.exec(t);
    if (m && +m[2] <= 12) return { time: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}T${pad(+m[4])}:${m[5]}`, fromPhoto: true };
    // phone status-bar clock at the top of a screenshot/photo: close to the transfer time
    const sb = /(?:^|\s)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?![\d:])/.exec(t.split(/\r?\n/).slice(0, 4).join(" "));
    if (sb) return { timeParts: { day: null, year: null, hm: `${pad(+sb[1])}:${sb[2]}`, approx: true } };
    return {};
  }
  /* identifiers printed on every slip to this shop (merchant / biller codes): never a transaction ref */
  const SHOP_CODE = /^(KPS\d|KB0{3,}\d+$|0107\d{9,}$|42423528$|TOTHEMOON)|0{5,}|2351536|^0?10753600/i;
  function cleanRef(tok) { return tok.replace(/O(?=\d)/g, "0").replace(/(?<=\d)O/g, "0"); }
  function slipRef(lines) {
    const pick = str => (str.match(/[A-Za-z0-9]{10,}/g) || []).map(cleanRef).filter(x => /\d/.test(x) && !SHOP_CODE.test(x));
    for (let i = 0; i < lines.length; i++) {
      if (/เลขที่รายการ|รหัสอ้างอิง|เลขอ้างอิง(?!\s*3)|ref\.?\s*(no|:)|transaction/i.test(lines[i])) {
        const c = pick(lines[i].replace(/.*?(เลขที่รายการ|รหัสอ้างอิง|เลขอ้างอิง|ref)/i, "")).concat(pick(lines[i + 1] || ""));
        if (c.length) return c.sort((a, b) => b.length - a.length)[0];
      }
    }
    const all = lines.flatMap(pick).filter(x => x.length >= 14);
    const mixed = all.filter(x => /[A-Za-z]/.test(x) && /\d{4,}/.test(x));
    return (mixed.length ? mixed : all).sort((a, b) => b.length - a.length)[0] || null;
  }
  /* every money figure with a weight: next to บาท/THB or จำนวน counts more, balance / fee lines count against */
  function amountVotes(text, votes) {
    const lines = text.split(/\r?\n/);
    lines.forEach((ln, i) => {
      SLIP_MONEY.lastIndex = 0; let m;
      while ((m = SLIP_MONEY.exec(ln))) {
        const v = +(m[1].replace(/[.,]/g, "") + "." + m[2]); if (!(v > 0) || v > 2e6) continue;
        const after = ln.slice(m.index + m[0].length, m.index + m[0].length + 6), before = ln.slice(0, m.index);
        let w = 1;
        if (/^\s*(บาท|thb|฿|บ\.)/i.test(after)) w += 1.5;
        if (/จำนวน|amount|ยอดเงิน|ยอดโอน/i.test(before + " " + (lines[i - 1] || ""))) w += 1.5;
        if (/คงเหลือ|ยอดคงเหลือ|balance|ค่าธรรมเนียม|fee/i.test(before)) w -= 3;
        if (/[.]\d{2}$/.test(m[0]) && /,/.test(m[1])) w += 0.2; else if (/,\d{2}$/.test(m[0])) w -= 0.5; // "700,00" = shaky read
        votes.set(v, (votes.get(v) || 0) + w);
      }
    });
  }
  /* texts = one slip read in one or more passes; returns amount only when the reads agree */
  function parseSlips(texts) {
    const votes = new Map(); texts.forEach(t => amountVotes(t, votes));
    const ranked = [...votes.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
    let amount = null, sure = false;
    if (ranked.length) {
      const [v, w] = ranked[0], second = ranked[1]?.[1] ?? 0;
      if (w >= 1.9 && w - second >= 0.9) { amount = v; sure = w >= 2.5; }
      else if (ranked.length === 1 && w >= 1) amount = v;          // a single figure on the slip, no competitor
      else if (texts.length === 1 && w >= 1 && w > second) amount = v;
    }
    let tm = {}; for (const t of texts) { const r = slipTime(t); if (r.time) { tm = r; break; } if (r.timeParts && !tm.timeParts) tm = r; }
    let ref = null; for (const t of texts) { ref = slipRef(t.split(/\r?\n/).map(x => x.trim()).filter(Boolean)); if (ref) break; }
    const all = texts.join("\n");
    const bank = (/(กสิกร|K\+|KBank|make by|ไทยพาณิชย์|SCB|กรุงเทพ|Bangkok Bank|กรุงไทย|Krungthai|กรุงศรี|Krungsri|KMA|ทหารไทย|ttb|ออมสิน|MyMo|GSB|ธ\.ก\.ส|BAAC|TrueMoney|CIMB|UOB|LH Bank|เกียรตินาคิน|KKP|Better)/i.exec(all) || [])[1] || null;
    const BANKS = { "k+": "กสิกรไทย", kbank: "กสิกรไทย", "make by": "กสิกรไทย", "กสิกร": "กสิกรไทย", scb: "ไทยพาณิชย์", mymo: "ออมสิน", gsb: "ออมสิน", kma: "กรุงศรี", krungsri: "กรุงศรี", kkp: "เกียรตินาคิน", better: "เกียรตินาคิน", ttb: "ttb", krungthai: "กรุงไทย", "bangkok bank": "กรุงเทพ" };
    return { amount, amountSure: sure, ...tm, ref, bank: bank ? (BANKS[bank.toLowerCase()] || bank) : null, sender: null, receiver: null };
  }
  function parseSlip(text) { return parseSlips([text]); }

  const api = { parseShift, parseSlip, parseSlips, parseDT, slipTime, sim, lev };
  if (typeof module === "object" && module.exports) module.exports = api; else root.ShiftOCR = api;
})(typeof window !== "undefined" ? window : globalThis);
