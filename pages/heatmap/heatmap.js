const dateUtil = require('../../utils/date');
const store = require('../../utils/store');
const themeUtil = require('../../utils/theme');

// 最多可以往前翻 12 个月
const MAX_MONTHS_BACK = 12;

function calcLevel(min) {
    if (min <= 0) return 0;
    if (min < 30) return 1;
    if (min < 60) return 2;
    if (min < 120) return 3;
    return 4;
}

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

Page({
    data: {
        theme: 'light',
        statusBarHeight: 0,
        state: 'loading', // loading | ready | error
        errorMsg: '',
        hasRecord: false,
        detail: null,
        // 月历
        weekDays: ['一', '二', '三', '四', '五', '六', '日'],
        viewYear: 0,
        viewMonth: 0,
        canPrev: false,
        canNext: false,
        cells: [],
        // 本月概览
        monthTotalText: '',
        monthDays: 0,
        monthCount: 0,
        monthBestText: '—',
    },

    onLoad: function () {
        this.todayStr = dateUtil.todayStr();
        const now = new Date();
        this.setData({
            viewYear: now.getFullYear(),
            viewMonth: now.getMonth() + 1,
        });
    },

    onShow: function () {
        themeUtil.applyToPage(this);
        this.load();
    },

    onRetry: function () {
        this.load();
    },

    load: function () {
        this.setData({ state: 'loading' });
        const minRes = store.minutesByDate();
        if (minRes.error) {
            this.setData({ state: 'error', errorMsg: minRes.error.message });
            return;
        }
        const minMap = minRes.data;
        const listRes = store.list();
        const sessions = listRes.error ? [] : listRes.data;

        const y = this.data.viewYear;
        const m = this.data.viewMonth;
        const mm = pad2(m);
        const first = y + '-' + mm + '-01';
        const daysInMonth = new Date(y, m, 0).getDate();
        // 周一开头的月历：算出 1 号前面要补几个空格
        const firstDow = dateUtil.dayOfWeek(first);
        const lead = firstDow === 0 ? 6 : firstDow - 1;

        const cells = [];
        let i;
        for (i = 0; i < lead; i++) {
            cells.push({ key: 'b' + i, empty: true, day: '', level: 0, minText: '' });
        }
        let totalMin = 0;
        let focusDays = 0;
        let bestMin = 0;
        let bestDay = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const date = y + '-' + mm + '-' + pad2(d);
            const min = minMap[date] || 0;
            if (min > 0) {
                focusDays += 1;
                if (min > bestMin) {
                    bestMin = min;
                    bestDay = d;
                }
            }
            totalMin += min;
            cells.push({
                key: date,
                day: d,
                date: date,
                level: calcLevel(min),
                future: date > this.todayStr,
                minText: min > 0 ? Math.round(min) + '分' : '',
            });
        }

        // 本月专注次数
        let count = 0;
        const prefix = y + '-' + mm;
        sessions.forEach(function (s) {
            if (s.date && s.date.indexOf(prefix) === 0) {
                count += 1;
            }
        });

        // 翻月边界：不能越过当前月，最多回看 12 个月
        const now = new Date();
        const viewDate = new Date(y, m - 1, 1);
        const canNext = viewDate < new Date(now.getFullYear(), now.getMonth(), 1);
        const canPrev = viewDate > new Date(now.getFullYear(), now.getMonth() - 1 - MAX_MONTHS_BACK, 1);

        this.setData({
            state: 'ready',
            cells: cells,
            canPrev: canPrev,
            canNext: canNext,
            hasRecord: Object.keys(minMap).length > 0,
            monthTotalText: dateUtil.fmtMinutes(totalMin),
            monthDays: focusDays,
            monthCount: count,
            monthBestText: bestDay > 0 ? bestDay + ' 日' : '—',
            detail: null,
        });
    },

    onPrevMonth: function () {
        if (!this.data.canPrev || this.data.state !== 'ready') {
            return;
        }
        let y = this.data.viewYear;
        let m = this.data.viewMonth - 1;
        if (m < 1) {
            m = 12;
            y -= 1;
        }
        this.setData({ viewYear: y, viewMonth: m });
        this.load();
    },

    onNextMonth: function () {
        if (!this.data.canNext || this.data.state !== 'ready') {
            return;
        }
        let y = this.data.viewYear;
        let m = this.data.viewMonth + 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
        this.setData({ viewYear: y, viewMonth: m });
        this.load();
    },

    onCellTap: function (e) {
        const date = e.currentTarget.dataset.date;
        const disabled = e.currentTarget.dataset.disabled;
        if (disabled || !date || this.data.state !== 'ready') {
            return;
        }
        const listRes = store.list();
        if (listRes.error) {
            this.setData({ messageText: listRes.error.message });
            return;
        }
        const sessions = listRes.data.filter(function (s) {
            return s.date === date;
        });
        const items = sessions.map(function (s) {
            const start = new Date(s.startTs);
            const end = new Date(s.endTs);
            return {
                id: s.id,
                tagText: s.tag || '未分类',
                noteText: s.note || '',
                abortText: s.abortReason || '',
                timeText: dateUtil.pad2(start.getHours()) + ':' + dateUtil.pad2(start.getMinutes())
                    + ' - ' + dateUtil.pad2(end.getHours()) + ':' + dateUtil.pad2(end.getMinutes()),
                durText: dateUtil.fmtMinutes((s.focusSec || 0) / 60),
                statusText: s.plannedMin === 0 ? '不限时专注' : (s.completed ? '达成目标' : '未达目标'),
                done: s.completed,
            };
        });
        const totalMin = minMapOf(listRes.data, date);
        this.setData({
            detail: {
                date: date,
                cn: dateUtil.fmtDateCN(date),
                totalText: dateUtil.fmtMinutes(totalMin),
                items: items,
                empty: items.length === 0,
            },
        });
    },

    onCloseDetail: function () {
        this.setData({ detail: null });
    },
});

function minMapOf(sessions, date) {
    let total = 0;
    sessions.forEach(function (s) {
        if (s.date === date) {
            total += (s.focusSec || 0) / 60;
        }
    });
    return Math.round(total * 10) / 10;
}
