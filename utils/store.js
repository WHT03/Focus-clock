/**
 * 专注记录本地数据层。
 *
 * 记录结构：
 * {
 *   id: string          唯一 id
 *   date: 'YYYY-MM-DD'  所属日期（按开始时间计）
 *   startTs: number     开始时间戳（毫秒）
 *   endTs: number       结束时间戳（毫秒）
 *   plannedMin: number  计划专注分钟数
 *   focusSec: number    实际专注秒数
 *   completed: boolean  是否完整完成
 * }
 *
 * 所有方法返回 { data, error }，不会 reject，错误码：
 * INVALID_ID / INVALID_PAYLOAD / NOT_FOUND_OR_FORBIDDEN / CLIENT_EXCEPTION
 */
const STORAGE_KEY = 'focus_sessions';
const CUSTOM_TAGS_KEY = 'focus_custom_tags';
const REMOVED_TAGS_KEY = 'focus_removed_tags';
const REMOVED_PRESETS_KEY = 'focus_removed_presets';
const SETTINGS_KEY = 'focus_settings';
const MAX_CUSTOM_TAGS = 8;

/**
 * 读取用户自定义的专注标签列表（最多 8 个）。
 */
function getCustomTags() {
    try {
        const v = wx.getStorageSync(CUSTOM_TAGS_KEY);
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

/**
 * 新增一个自定义标签：去除首尾空格、限制 6 字以内、去重。
 * 成功返回 { data: 标签, error: null }；无效或超限返回 error。
 */
function addCustomTag(raw) {
    const tag = String(raw || '').trim();
    if (!tag) {
        return { data: null, error: err('INVALID_PAYLOAD', '标签不能为空') };
    }
    if (tag.length > 6) {
        return { data: null, error: err('INVALID_PAYLOAD', '标签最多 6 个字') };
    }
    const tags = getCustomTags();
    if (tags.indexOf(tag) !== -1) {
        return { data: tag, error: null };
    }
    if (tags.length >= MAX_CUSTOM_TAGS) {
        return { data: null, error: err('INVALID_PAYLOAD', '自定义标签最多 8 个') };
    }
    tags.push(tag);
    try {
        wx.setStorageSync(CUSTOM_TAGS_KEY, tags);
        return { data: tag, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '保存自定义标签失败：' + e.message) };
    }
}

/**
 * 读取被用户删除的自带标签列表。
 */
function getRemovedTags() {
    try {
        const v = wx.getStorageSync(REMOVED_TAGS_KEY);
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

/**
 * 删除一个标签：自定义标签从自定义列表移除；自带标签记入移除列表。
 * 成功返回 { data: 标签, error: null }。
 */
function deleteTag(raw) {
    const tag = String(raw || '').trim();
    if (!tag) {
        return { data: null, error: err('INVALID_PAYLOAD', '标签不能为空') };
    }
    const customs = getCustomTags();
    const idx = customs.indexOf(tag);
    try {
        if (idx !== -1) {
            // 自定义标签：直接从列表移除
            customs.splice(idx, 1);
            wx.setStorageSync(CUSTOM_TAGS_KEY, customs);
        } else {
            // 自带标签：记入移除列表，之后不再展示
            const removed = getRemovedTags();
            if (removed.indexOf(tag) === -1) {
                removed.push(tag);
                wx.setStorageSync(REMOVED_TAGS_KEY, removed);
            }
        }
        return { data: tag, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '删除标签失败：' + e.message) };
    }
}

/**
 * 恢复一个被删除的自带标签（用户在输入框重新输入同名标签时）。
 */
function restoreTag(raw) {
    const tag = String(raw || '').trim();
    if (!tag) {
        return { data: null, error: null };
    }
    const removed = getRemovedTags();
    const idx = removed.indexOf(tag);
    if (idx === -1) {
        return { data: tag, error: null };
    }
    removed.splice(idx, 1);
    try {
        wx.setStorageSync(REMOVED_TAGS_KEY, removed);
        return { data: tag, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '恢复标签失败：' + e.message) };
    }
}

/**
 * 读取被用户删除的目标时长预设（分钟数数组）。
 */
function getRemovedPresets() {
    try {
        const v = wx.getStorageSync(REMOVED_PRESETS_KEY);
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

/**
 * 删除一个目标时长预设：记入移除列表。
 */
function deletePreset(min) {
    const n = parseInt(min, 10);
    if (isNaN(n) || n <= 0) {
        return { data: null, error: err('INVALID_PAYLOAD', '预设时长不合法') };
    }
    const removed = getRemovedPresets();
    if (removed.indexOf(n) === -1) {
        removed.push(n);
    }
    try {
        wx.setStorageSync(REMOVED_PRESETS_KEY, removed);
        return { data: n, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '删除预设失败：' + e.message) };
    }
}

/**
 * 恢复一个被删除的目标时长预设（用户在自定义输入框输入该值时）。
 */
function restorePreset(min) {
    const n = parseInt(min, 10);
    if (isNaN(n)) {
        return { data: null, error: null };
    }
    const removed = getRemovedPresets();
    const idx = removed.indexOf(n);
    if (idx === -1) {
        return { data: n, error: null };
    }
    removed.splice(idx, 1);
    try {
        wx.setStorageSync(REMOVED_PRESETS_KEY, removed);
        return { data: n, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '恢复预设失败：' + e.message) };
    }
}

/**
 * 读取「每小时休息提醒」开关（默认关闭）。
 */
function getRestReminder() {
    try {
        const v = wx.getStorageSync(SETTINGS_KEY);
        return !!(v && typeof v === 'object' && v.restReminder);
    } catch (e) {
        return false;
    }
}

/**
 * 设置「每小时休息提醒」开关。
 */
function setRestReminder(on) {
    let settings = {};
    try {
        const raw = wx.getStorageSync(SETTINGS_KEY);
        if (raw && typeof raw === 'object') {
            settings = raw;
        }
    } catch (e0) {
        // 忽略，从空设置开始
    }
    settings.restReminder = !!on;
    try {
        wx.setStorageSync(SETTINGS_KEY, settings);
        return { data: !!on, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '保存设置失败：' + e.message) };
    }
}

function list() {
    try {
        const v = wx.getStorageSync(STORAGE_KEY);
        return { data: Array.isArray(v) ? v : [], error: null };
    } catch (e) {
        return { data: [], error: err('CLIENT_EXCEPTION', '读取专注记录失败：' + e.message) };
    }
}

function create(payload) {
    if (!payload || !payload.date || typeof payload.focusSec !== 'number') {
        return { data: null, error: err('INVALID_PAYLOAD', '记录字段不完整') };
    }
    const record = {
        id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: payload.date,
        startTs: payload.startTs || Date.now(),
        endTs: payload.endTs || Date.now(),
        plannedMin: payload.plannedMin || 0,
        focusSec: payload.focusSec,
        completed: !!payload.completed,
        tag: payload.tag || '',
        note: payload.note || '',
        abortReason: payload.abortReason || '',
    };
    const res = list();
    if (res.error) {
        return res;
    }
    const sessions = res.data;
    sessions.push(record);
    try {
        wx.setStorageSync(STORAGE_KEY, sessions);
        return { data: record, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '保存专注记录失败：' + e.message) };
    }
}

function removeById(id) {
    if (!id) {
        return { data: null, error: err('INVALID_ID', '缺少记录 id') };
    }
    const res = list();
    if (res.error) {
        return res;
    }
    const sessions = res.data;
    const next = sessions.filter(function (s) {
        return s.id !== id;
    });
    if (next.length === sessions.length) {
        return { data: null, error: err('NOT_FOUND_OR_FORBIDDEN', '记录不存在') };
    }
    try {
        wx.setStorageSync(STORAGE_KEY, next);
        return { data: true, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '删除专注记录失败：' + e.message) };
    }
}

/**
 * 按日期聚合：返回 { 'YYYY-MM-DD': minutes }，minutes 保留 1 位小数。
 */
function minutesByDate() {
    const res = list();
    if (res.error) {
        return res;
    }
    const map = {};
    res.data.forEach(function (s) {
        const min = (s.focusSec || 0) / 60;
        if (!map[s.date]) {
            map[s.date] = 0;
        }
        map[s.date] += min;
    });
    Object.keys(map).forEach(function (k) {
        map[k] = Math.round(map[k] * 10) / 10;
    });
    return { data: map, error: null };
}

/**
 * 更新某条记录的专注描述（结束计时后用户填写）。
 * 传空字符串表示清空描述；最长保留 50 字。
 */
function updateNote(id, note) {
    if (!id) {
        return { data: null, error: err('INVALID_ID', '缺少记录 id') };
    }
    const text = String(note || '').trim().slice(0, 50);
    const res = list();
    if (res.error) {
        return res;
    }
    const sessions = res.data;
    let found = false;
    sessions.forEach(function (s) {
        if (s.id === id) {
            s.note = text;
            found = true;
        }
    });
    if (!found) {
        return { data: null, error: err('NOT_FOUND_OR_FORBIDDEN', '记录不存在') };
    }
    try {
        wx.setStorageSync(STORAGE_KEY, sessions);
        return { data: text, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '保存描述失败：' + e.message) };
    }
}

/**
 * 更新某条记录的未完成原因（未达目标就结束时用户填写）。
 * 传空字符串表示清空；最长保留 50 字。
 */
function updateAbortReason(id, reason) {
    if (!id) {
        return { data: null, error: err('INVALID_ID', '缺少记录 id') };
    }
    const text = String(reason || '').trim().slice(0, 50);
    const res = list();
    if (res.error) {
        return res;
    }
    const sessions = res.data;
    let found = false;
    sessions.forEach(function (s) {
        if (s.id === id) {
            s.abortReason = text;
            found = true;
        }
    });
    if (!found) {
        return { data: null, error: err('NOT_FOUND_OR_FORBIDDEN', '记录不存在') };
    }
    try {
        wx.setStorageSync(STORAGE_KEY, sessions);
        return { data: text, error: null };
    } catch (e) {
        return { data: null, error: err('CLIENT_EXCEPTION', '保存原因失败：' + e.message) };
    }
}

function err(code, message) {
    return { code: code, message: message };
}

module.exports = {
    list: list,
    create: create,
    removeById: removeById,
    minutesByDate: minutesByDate,
    getCustomTags: getCustomTags,
    addCustomTag: addCustomTag,
    getRemovedTags: getRemovedTags,
    deleteTag: deleteTag,
    restoreTag: restoreTag,
    getRemovedPresets: getRemovedPresets,
    deletePreset: deletePreset,
    restorePreset: restorePreset,
    getRestReminder: getRestReminder,
    setRestReminder: setRestReminder,
    updateNote: updateNote,
    updateAbortReason: updateAbortReason,
};
