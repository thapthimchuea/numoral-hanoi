// Numoral Hanoi — ดึงผลหวยฮานอยปกติ (XSMB) งวดใหม่มาเก็บใน data/draws.json
// แหล่งหลัก: raakaadee.com (หน้า "หวยฮานอยปกติ")
// แหล่งตรวจเทียบ: RSS ผลสลากภาคเหนือเวียดนามของ xskt.com.vn (ĐB = รางวัลพิเศษ, 1 = รางวัลที่ 1)
// กติกา: ถ้าได้ทั้งสองแหล่งและเลขตรงกัน → บันทึก · ถ้าไม่ตรงกัน → ไม่บันทึก (รอรอบหน้า)
//        ถ้ามีแหล่งเดียว → บันทึกเมื่ออีกแหล่งเปิดไม่ได้ หรือเป็นงวดของวันก่อนหน้า (เช้าวันถัดไป)
// รูปแบบที่เก็บ: { d: "YYYYMMDD", n: "รางวัลพิเศษ 5 หลัก", b: "2 ตัวท้ายรางวัลที่ 1" }
// ใช้:  node scripts/update-draws.mjs            (ดึงจริง)
//       node scripts/update-draws.mjs --test     (ทดสอบตัวแยกข้อมูลกับตัวอย่างในไฟล์ ไม่ต่อเน็ต)
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../data/draws.json', import.meta.url);
const RAAKAADEE = y => `https://www.raakaadee.com/${encodeURIComponent('หวย')}/${encodeURIComponent('หวยฮานอยปกติ')}/-${y}/?v=${Date.now()}`;
const XSKT_RSS = 'https://xskt.com.vn/rss-feed/mien-bac-xsmb.rss';
const UA = 'Mozilla/5.0 (compatible; NumoralHanoi-bot/1.0; +https://github.com/)';

const M_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WD = { 'อา.': 0, 'จ.': 1, 'อ.': 2, 'พ.': 3, 'พฤ.': 4, 'ศ.': 5, 'ส.': 6 };
const pad = n => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}${pad(m + 1)}${pad(d)}`;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// แปลง HTML เป็นข้อความล้วน (ตัดแท็ก/สคริปต์ ถอดรหัส entity พื้นฐาน)
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\d{1,2}[:.]\d{2}\s*น\./g, ' ')          // เวลา เช่น 18:30 น.
    .replace(/[1-5]\s*ตัว\s*(บน|ล่าง|โต๊ด)?/g, ' ')    // ป้ายกำกับ เช่น 3 ตัวบน / 2 ตัวล่าง
    .replace(/\s+/g, ' ');
}

// raakaadee: หลังวันที่ ตัวเลขที่ตามมาคือ รางวัลที่ 1 (5 หลัก), เลขท้าย 3 ตัว, เลขท้าย 2 ตัว, เลข 2 ตัว (ล่าง)
// → 3 ตัว + 2 ตัว ต้องตรงกับท้ายของเลข 5 หลัก จึงยืนยันได้ว่าอ่านถูกแถว
function pickRow(after) {
  const d = (after.slice(0, 70).match(/\d/g) || []).join('');
  const n = d.slice(0, 5);
  if (n.length < 5) return null;
  const rest = d.slice(5);
  const want = n.slice(-3) + n.slice(-2);
  if (!rest.startsWith(want)) return null;
  const b = rest.slice(5, 7);
  return b.length === 2 ? { n, b } : null;
}

export function parseRaakaadee(html) {
  const t = toText(html), out = {};
  const re = new RegExp(`(${Object.keys(WD).map(esc).join('|')})\\s*(\\d{1,2})\\s*(${M_SHORT.map(esc).join('|')})\\s*(\\d{2})(?!\\d)`, 'g');
  let m;
  while ((m = re.exec(t))) {
    const y = 2500 + +m[4] - 543, mo = M_SHORT.indexOf(m[3]), d = +m[2];
    const dt = new Date(Date.UTC(y, mo, d));
    if (dt.getUTCDate() !== d || dt.getUTCDay() !== WD[m[1]]) continue; // วันในสัปดาห์ต้องตรงกับวันที่
    const r = pickRow(t.slice(re.lastIndex));
    if (r) out[key(y, mo, d)] = r;
  }
  return out;
}

// RSS เวียดนาม: แต่ละ <item> มีวันที่ dd/mm (บางครั้งมีปี) ในหัวเรื่อง และในเนื้อหามี "ĐB: 12345" กับ "1: 12345"
export function parseXsktRss(xml, todayKey) {
  const out = {};
  const ty = +todayKey.slice(0, 4), tm = +todayKey.slice(4, 6);
  for (const item of xml.split(/<item[\s>]/i).slice(1)) {
    const txt = item.replace(/<!\[CDATA\[|\]\]>/g, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const title = (item.match(/<title>([\s\S]*?)<\/title>/i) || [, txt])[1];
    const dm = title.match(/(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*(\d{4}))?/);
    const db = txt.match(/(?:ĐB|Đặc biệt|DB)\s*[:.]?\s*(\d{5})(?!\d)/i);
    const g1 = txt.match(/(?:^|[^\d])(?:1|G\.?1|Giải nhất)\s*:\s*(\d{5})(?!\d)/i);
    if (!dm || !db || !g1) continue;
    const d = +dm[1], mo = +dm[2] - 1;
    let y = dm[3] ? +dm[3] : (mo + 1 > tm ? ty - 1 : ty);
    const dt = new Date(Date.UTC(y, mo, d));
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo) continue;
    out[key(y, mo, d)] = { n: db[1], b: g1[1].slice(-2) };
  }
  return out;
}

async function get(url) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'th,vi;q=0.9,en;q=0.8' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(tm); }
}

function bangkokToday() {
  const now = new Date(Date.now() + 7 * 3600e3);
  return { key: key(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate() };
}
const keyAddDays = (k, n) => { const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8) + n)); return key(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const same = (a, b) => a.n === b.n && a.b === b.b;

async function main() {
  const db = JSON.parse(readFileSync(FILE, 'utf8'));
  db.draws = Array.isArray(db.draws) ? db.draws : [];
  const known = new Map(db.draws.map(r => [r.d, r]));
  const latest = [db.since || '00000000', ...known.keys()].sort().pop();
  const today = bangkokToday();

  const errors = [];
  let A = null, B = null;
  try {
    A = {};
    const years = [today.y + 543]; if (today.m === 0 && today.d <= 20) years.push(today.y + 542);
    for (const y of years) Object.assign(A, parseRaakaadee(await get(RAAKAADEE(y))));
    if (!Object.keys(A).length) throw new Error('อ่านตารางไม่ได้ (รูปแบบหน้าเว็บอาจเปลี่ยน)');
  } catch (e) { errors.push('raakaadee: ' + e.message); A = null; }
  try {
    B = parseXsktRss(await get(XSKT_RSS), today.key);
    if (!Object.keys(B).length) throw new Error('อ่าน RSS ไม่ได้ (รูปแบบอาจเปลี่ยน)');
  } catch (e) { errors.push('xskt RSS: ' + e.message); B = null; }

  const cands = new Set([...Object.keys(A || {}), ...Object.keys(B || {})].filter(k => k > latest && k <= today.key));
  const added = [], skipped = [];
  for (const k of [...cands].sort()) {
    const a = A && A[k], b = B && B[k];
    if (a && b) { same(a, b) ? added.push({ d: k, ...a }) : skipped.push(`${k}: ไม่ตรงกัน (${a.n}/${a.b} กับ ${b.n}/${b.b})`); continue; }
    const one = a || b, otherDown = a ? !B : !A, old = k < today.key; // งวดก่อนวันนี้ (เวลาไทย) บันทึกจากแหล่งเดียวได้ ไม่ต้องรอ 2 วัน
    if (otherDown || old) added.push({ d: k, ...one });
    else skipped.push(`${k}: รออีกแหล่งยืนยัน (${one.n}/${one.b})`);
  }

  const at = new Date().toISOString();
  db.lastCheck = { at, ok: !!(A || B), sources: { raakaadee: !!A, xskt: !!B }, ...(errors.length ? { errors } : {}), ...(skipped.length ? { skipped } : {}) };
  if (added.length) {
    added.forEach(r => known.set(r.d, { d: r.d, n: r.n, b: r.b }));
    db.draws = [...known.values()].sort((x, y) => x.d.localeCompare(y.d));
    db.updatedAt = at;
  }
  writeFileSync(FILE, JSON.stringify(db, null, 1) + '\n');
  console.log(`ล่าสุดเดิม ${latest} · เพิ่ม ${added.length} งวด`, added.map(r => `${r.d}=${r.n}/${r.b}`).join(' '));
  skipped.forEach(s => console.log('ข้าม', s));
  errors.forEach(s => console.log('ผิดพลาด', s));
  if (!A && !B) process.exitCode = 1;
}

function selfTest() {
  // ตัวอย่างจากผลจริง: 14 พ.ย. 69 รางวัลพิเศษ 20893 รางวัลที่ 1 14291 · 13 พ.ย. 69 = 05235/50 (ตัวอย่างสมมติ)
  const rk = `<table><tr><td>ส. 14 พ.ย. 69</td><td><b>20893</b></td><td>893</td><td>93</td><td>91</td></tr>
  <tr><td>ศ. 13 พ.ย. 69</td><td>0 5 2 3 5</td><td>235</td><td>35</td><td>50</td></tr>
  <tr><td>พฤ. 13 พ.ย. 69</td><td>11111</td><td>111</td><td>11</td><td>11</td></tr>
  <tr><td>พฤ. 12 พ.ย. 69</td><td>12345</td><td>999</td><td>45</td><td>10</td></tr></table>`;
  const rss = `<rss><channel><item><title>KẾT QUẢ XỔ SỐ MIỀN BẮC NGÀY 14/11 (Thứ Bảy)</title><description><![CDATA[ĐB: 20893<br>1: 14291<br>2: 11312 - 51790<br>3: 44626 - 32334]]></description></item>
  <item><title>XSMB 31/12/2025</title><description>ĐB: 64960 1: 12358 2: 11111</description></item>
  <item><title>tin khác 13/11</title><description>không có kết quả</description></item></channel></rss>`;
  const a = parseRaakaadee(rk), b = parseXsktRss(rss, '20261118');
  const ok = a['20261114'] && a['20261114'].n === '20893' && a['20261114'].b === '91' && a['20261113'] && a['20261113'].n === '05235' && a['20261113'].b === '50'
    && Object.keys(a).length === 2 && b['20261114'] && same(b['20261114'], a['20261114']) && b['20251231'] && b['20251231'].b === '58' && Object.keys(b).length === 2;
  console.log(ok ? 'ผ่าน' : 'ไม่ผ่าน', a, b);
  if (!ok) process.exitCode = 1;
}

if (process.argv.includes('--test')) selfTest(); else main().catch(e => { console.error(e); process.exitCode = 1; });
