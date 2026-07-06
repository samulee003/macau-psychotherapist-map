/* ============================================================
   診症時間結構化解析：把 data.json 的 hours 自由文字
   （如「星期一至星期六 12:30-19:30」）解析為可計算的時段結構，
   支援「現在營業」「週末開診」「夜間開診」等時段篩選。
   ============================================================
   解析結果格式：
     [{ days: [1,2,...], ranges: [[startMin, endMin], ...] }, ...]
   - days 使用 Date.getDay() 慣例：0=星期日、1=星期一 … 6=星期六
   - ranges 為當日分鐘數區間（含起、不含迄）；可為空陣列
     （如「星期一至星期六 預約」— 知道開診日但不知時段）
   - 無法解析（空字串、「暫未提供資料」等）回傳 null
   ============================================================ */

const DAY_MAP = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const EVENING_START_MIN = 18 * 60; // 「夜間開診」定義：18:00 後仍在開診

/** 展開「星期A至星期B」為日序陣列（支援跨週日，如一至日） */
function expandDays(from, to) {
  const days = [];
  let d = from;
  for (let i = 0; i < 7; i++) {
    days.push(d);
    if (d === to) break;
    d = (d + 1) % 7;
  }
  return days;
}

/** 解析「09:00-13:00,14:30-19:00」為分鐘區間陣列 */
function parseRanges(text) {
  const ranges = [];
  const re = /(\d{1,2})[:：](\d{2})\s*[-–~]\s*(\d{1,2})[:：](\d{2})/g;
  let m;
  while ((m = re.exec(text || ''))) {
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}

/**
 * 解析 hours 自由文字。
 * @param {string} text 如「星期一至星期五 09:00-13:00,15:00-19:00」
 * @returns {Array<{days:number[], ranges:number[][]}>|null}
 */
export function parseHours(text) {
  if (!text) return null;
  const groups = [];
  const re = /星期([一二三四五六日天])(?:至星期([一二三四五六日天]))?\s*([0-9０-９:：,，\-–~\s]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const from = DAY_MAP[m[1]];
    const to = m[2] != null ? DAY_MAP[m[2]] : from;
    groups.push({ days: expandDays(from, to), ranges: parseRanges(m[3]) });
  }
  return groups.length > 0 ? groups : null;
}

/**
 * 某時間點是否在開診時段內。
 * @param {Array|null} groups parseHours 的結果
 * @param {Date} date
 */
export function isOpenAt(groups, date) {
  if (!groups) return false;
  const day = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  return groups.some(
    (g) => g.days.includes(day) && g.ranges.some(([s, e]) => mins >= s && mins < e)
  );
}

/** 週末（星期六或日）是否有開診（僅需知道開診日，不要求知道時段） */
export function opensOnWeekend(groups) {
  if (!groups) return false;
  return groups.some((g) => g.days.includes(6) || g.days.includes(0));
}

/** 是否有夜間時段（18:00 後仍開診） */
export function opensEvening(groups) {
  if (!groups) return false;
  return groups.some((g) => g.ranges.some(([, end]) => end > EVENING_START_MIN));
}

/**
 * 取地點的解析結果（記憶化，直接掛在 location 物件上避免重複解析）。
 * @param {Object} loc data.json 的 location
 */
export function getParsedHours(loc) {
  if (loc._hoursParsed === undefined) {
    loc._hoursParsed = parseHours(loc.hours);
  }
  return loc._hoursParsed;
}

/** 地點現在是否營業中（無法解析時回傳 false） */
export function isLocationOpenNow(loc, now = new Date()) {
  return isOpenAt(getParsedHours(loc), now);
}
