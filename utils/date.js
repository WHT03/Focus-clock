/**
 * 日期工具：全部基于本地时区，日期字符串格式统一为 YYYY-MM-DD。
 */
function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function toDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseDate(dateStr) {
    const parts = dateStr.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function todayStr() {
    return toDateStr(new Date());
}

function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
}

/**
 * 0=周日 1=周一 ... 6=周六
 */
function dayOfWeek(dateStr) {
    return parseDate(dateStr).getDay();
}

/**
 * 返回本周周一的日期字符串。
 */
function mondayOf(dateStr) {
    const dow = dayOfWeek(dateStr);
    const diff = dow === 0 ? -6 : 1 - dow;
    return addDays(dateStr, diff);
}

function fmtDateCN(dateStr) {
    const d = parseDate(dateStr);
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

/**
 * 分钟数格式化：不足 1 小时显示「X 分钟」，否则「X 小时 Y 分钟」。
 */
function fmtMinutes(min) {
    const m = Math.round(min);
    if (m < 60) {
        return m + ' 分钟';
    }
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r === 0 ? h + ' 小时' : h + ' 小时 ' + r + ' 分钟';
}

/**
 * 秒数格式化为 mm:ss（超过 1 小时显示 h:mm:ss）。
 */
function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
        return h + ':' + pad2(m) + ':' + pad2(s);
    }
    return pad2(m) + ':' + pad2(s);
}

/**
 * 获取设备像素比：优先用新接口 wx.getWindowInfo，
 * 旧基础库降级 getSystemInfoSync，都失败返回 2。
 */
function getPixelRatio() {
    try {
        if (wx.getWindowInfo) {
            return wx.getWindowInfo().pixelRatio || 2;
        }
    } catch (e) {
        // 继续降级
    }
    try {
        return wx.getSystemInfoSync().pixelRatio || 2;
    } catch (e2) {
        return 2;
    }
}

module.exports = {
    pad2: pad2,
    toDateStr: toDateStr,
    parseDate: parseDate,
    todayStr: todayStr,
    addDays: addDays,
    dayOfWeek: dayOfWeek,
    mondayOf: mondayOf,
    fmtDateCN: fmtDateCN,
    fmtMinutes: fmtMinutes,
    fmtClock: fmtClock,
    getPixelRatio: getPixelRatio,
};
