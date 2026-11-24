const dateUtil = require('../../utils/date');
const store = require('../../utils/store');
const themeUtil = require('../../utils/theme');

const TAG_COLORS = ['#4f46e5', '#2f9e44', '#f59f00', '#e5484d', '#0ca678', '#8a9099'];
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const HEAT_COLORS = ['#ebedf0', '#b2f2bb', '#69db7c', '#2f9e44', '#1e6e33'];

function heatLevel(min) {
    if (min <= 0) return 0;
    if (min < 30) return 1;
    if (min < 60) return 2;
    if (min < 120) return 3;
    return 4;
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

Page({
    data: {
        theme: 'light',
        state: 'loading', // loading | ready | error
        errorMsg: '',
        isEmpty: false,
        // 指标卡
        todayText: '',
        weekText: '',
        totalText: '',
        totalCount: 0,
        avgText: '',
        streakDays: 0,
        bestText: '',
        // 近 7 天柱状图
        bars: [],
        barMaxLabel: '',
        // 标签分布
        tagStats: [],
        // 记录列表（最近 10 条）
        recentItems: [],
        // 专注设置：每小时休息提醒
        restReminder: false,
    },

    onShow: function () {
        themeUtil.applyToPage(this);
        this.setData({ restReminder: store.getRestReminder() });
        this.load();
    },

    /** 切换深色模式：写偏好 + 立即生效（页面/导航栏/tabBar 同步变色） */
    onThemeToggle: function () {
        const next = this.data.theme === 'dark' ? 'light' : 'dark';
        themeUtil.setTheme(next);
        this.setData({ theme: next });
        themeUtil.applySystemBars(next);
    },

    /** 切换「每小时休息提醒」开关 */
    onRestReminderToggle: function () {
        const next = !this.data.restReminder;
        const res = store.setRestReminder(next);
        if (res.error) {
            return;
        }
        this.setData({ restReminder: next });
    },

    onRetry: function () {
        this.load();
    },

    load: function () {
        this.setData({ state: 'loading' });
        const listRes = store.list();
        if (listRes.error) {
            this.setData({ state: 'error', errorMsg: listRes.error.message });
            return;
        }
        const sessions = listRes.data;
        if (sessions.length === 0) {
            this.cardData = null;
            this.setData({
                state: 'ready',
                isEmpty: true,
                bars: this.buildBars({}),
                tagStats: [],
                recentItems: [],
            });
            return;
        }

        const today = dateUtil.todayStr();
        const monday = dateUtil.mondayOf(today);

        let totalSec = 0;
        let todaySec = 0;
        let weekSec = 0;
        const byDate = {};
        const tagMap = {};
        let bestDate = '';
        let bestMin = 0;

        sessions.forEach(function (s) {
            const sec = s.focusSec || 0;
            totalSec += sec;
            if (s.date === today) {
                todaySec += sec;
            }
            if (s.date >= monday) {
                weekSec += sec;
            }
            const min = Math.round((sec / 60) * 10) / 10;
            if (!byDate[s.date]) {
                byDate[s.date] = 0;
            }
            byDate[s.date] += min;
            const tag = s.tag || '未分类';
            if (!tagMap[tag]) {
                tagMap[tag] = 0;
            }
            tagMap[tag] += min;
        });

        Object.keys(byDate).forEach(function (d) {
            if (byDate[d] > bestMin) {
                bestMin = byDate[d];
                bestDate = d;
            }
        });

        // 连续打卡：从今天（或昨天）往前数，每天须有记录（当天完成或放弃均算打卡）
        const streak = this.calcStreak(Object.keys(byDate), today);

        // 标签分布（按时长降序）
        const tagTotalMin = Object.keys(tagMap).reduce(function (acc, k) {
            return acc + tagMap[k];
        }, 0);
        const tagStats = Object.keys(tagMap)
            .sort(function (a, b) {
                return tagMap[b] - tagMap[a];
            })
            .map(function (name, i) {
                const min = tagMap[name];
                return {
                    name: name,
                    color: TAG_COLORS[i % TAG_COLORS.length],
                    pct: Math.max(6, Math.round((min / tagTotalMin) * 100)),
                    text: dateUtil.fmtMinutes(min),
                };
            });

        const sorted = sessions.slice().sort(function (a, b) {
            return b.startTs - a.startTs;
        });
        const recentItems = sorted.slice(0, 10).map(function (s) {
            const start = new Date(s.startTs);
            const end = new Date(s.endTs);
            return {
                id: s.id,
                dateText: dateUtil.fmtDateCN(s.date),
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

        // 供分享卡片绘制使用
        this.cardData = {
            today: today,
            todayText: dateUtil.fmtMinutes(todaySec / 60),
            streakDays: streak,
            totalText: dateUtil.fmtMinutes(totalSec / 60),
            totalCount: sessions.length,
            bestText: bestDate ? dateUtil.fmtDateCN(bestDate) : '暂无',
            minMap: byDate,
        };

        this.setData({
            state: 'ready',
            isEmpty: false,
            todayText: dateUtil.fmtMinutes(todaySec / 60),
            weekText: dateUtil.fmtMinutes(weekSec / 60),
            totalText: dateUtil.fmtMinutes(totalSec / 60),
            totalCount: sessions.length,
            avgText: dateUtil.fmtMinutes(totalSec / 60 / sessions.length),
            streakDays: streak,
            bestText: bestDate ? dateUtil.fmtDateCN(bestDate) + '（' + dateUtil.fmtMinutes(bestMin) + '）' : '暂无',
            bars: this.buildBars(byDate),
            barMaxLabel: '',
            tagStats: tagStats,
            recentItems: recentItems,
        });
    },

    calcStreak: function (dates, today) {
        if (dates.length === 0) {
            return 0;
        }
        const set = {};
        dates.forEach(function (d) {
            set[d] = true;
        });
        let cursor = today;
        if (!set[cursor]) {
            cursor = dateUtil.addDays(today, -1);
            if (!set[cursor]) {
                return 0;
            }
        }
        let streak = 0;
        while (set[cursor]) {
            streak += 1;
            cursor = dateUtil.addDays(cursor, -1);
        }
        return streak;
    },

    buildBars: function (byDate) {
        const today = dateUtil.todayStr();
        const names = WEEKDAY_NAMES;
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = dateUtil.addDays(today, -i);
            days.push({
                date: d,
                min: byDate[d] || 0,
                label: names[dateUtil.dayOfWeek(d)],
            });
        }
        const max = Math.max.apply(null, days.map(function (d) {
            return d.min;
        }).concat([1]));
        return days.map(function (d) {
            return {
                label: d.label,
                minText: d.min > 0 ? Math.round(d.min) + '分' : '',
                pct: Math.max(4, Math.round((d.min / max) * 100)),
                today: d.date === today,
            };
        });
    },

    /* ============ 打卡分享卡片 ============ */

    onShareCard: function () {
        if (this.data.isEmpty) {
            wx.showToast({ title: '还没有专注记录', icon: 'none' });
            return;
        }
        const that = this;
        wx.createSelectorQuery()
            .select('#share-canvas')
            .fields({ node: true })
            .exec(function (res) {
                if (!res || !res[0] || !res[0].node) {
                    wx.showToast({ title: '卡片初始化失败', icon: 'none' });
                    return;
                }
                const canvas = res[0].node;
                const dpr = dateUtil.getPixelRatio();
                canvas.width = 600 * dpr;
                canvas.height = 960 * dpr;
                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                that.paintShareCard(ctx);
                wx.canvasToTempFilePath({
                    canvas: canvas,
                    success: function (r) {
                        const path = r.tempFilePath;
                        if (wx.showShareImageMenu) {
                            wx.showShareImageMenu({
                                path: path,
                                fail: function () {
                                    that.saveCard(path);
                                },
                            });
                        } else {
                            that.saveCard(path);
                        }
                    },
                    fail: function () {
                        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
                    },
                });
            });
    },

    saveCard: function (path) {
        wx.saveImageToPhotosAlbum({
            filePath: path,
            success: function () {
                wx.showToast({ title: '已保存到相册', icon: 'success' });
            },
            fail: function (e) {
                const authFail = e && e.errMsg && e.errMsg.indexOf('auth') >= 0;
                wx.showToast({
                    title: authFail ? '需要相册权限，请在设置中开启' : '保存失败，请重试',
                    icon: 'none',
                });
            },
        });
    },

    paintShareCard: function (ctx) {
        const d = this.cardData;
        const parsed = dateUtil.parseDate(d.today);
        const dateText = parsed.getFullYear() + '年' + (parsed.getMonth() + 1) + '月' + parsed.getDate() + '日'
            + ' · 星期' + WEEKDAY_NAMES[parsed.getDay()];

        // 背景
        ctx.fillStyle = '#f5f7fa';
        ctx.fillRect(0, 0, 600, 960);

        // 顶部主卡
        ctx.fillStyle = '#4f46e5';
        roundRectPath(ctx, 24, 24, 552, 300, 24);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText('专注打卡', 56, 96);
        ctx.font = '24px sans-serif';
        ctx.globalAlpha = 0.85;
        ctx.fillText(dateText, 56, 136);
        ctx.globalAlpha = 1;

        ctx.font = '22px sans-serif';
        ctx.globalAlpha = 0.8;
        ctx.fillText('今日专注', 56, 210);
        ctx.fillText('连续打卡', 390, 210);
        ctx.globalAlpha = 1;
        ctx.font = 'bold 56px sans-serif';
        ctx.fillText(this.compactMinutes(d.todayText), 56, 268);
        ctx.font = 'bold 56px sans-serif';
        ctx.fillText(d.streakDays + ' 天', 390, 268);

        // 指标行
        const rows = [
            ['累计专注', d.totalText],
            ['累计次数', d.totalCount + ' 次'],
            ['最佳专注日', d.bestText],
        ];
        let y = 400;
        rows.forEach(function (row) {
            ctx.fillStyle = '#8a9099';
            ctx.font = '26px sans-serif';
            ctx.fillText(row[0], 56, y);
            ctx.fillStyle = '#1f2329';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(row[1], 544, y);
            ctx.textAlign = 'left';
            ctx.strokeStyle = '#eceef3';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(56, y + 26);
            ctx.lineTo(544, y + 26);
            ctx.stroke();
            y += 68;
        });

        // 迷你热力图（最近 16 周）
        ctx.fillStyle = '#1f2329';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText('最近 16 周', 56, 660);
        const cell = 18;
        const gap = 4;
        const pitch = cell + gap;
        const monday = dateUtil.mondayOf(d.today);
        for (let w = 15; w >= 0; w--) {
            const weekStart = dateUtil.addDays(monday, -7 * w);
            for (let i = 0; i < 7; i++) {
                const dt = dateUtil.addDays(weekStart, i);
                if (dt > d.today) {
                    continue;
                }
                const min = d.minMap[dt] || 0;
                ctx.fillStyle = HEAT_COLORS[heatLevel(min)];
                const x = 56 + (15 - w) * pitch;
                const gy = 690 + i * pitch;
                roundRectPath(ctx, x, gy, cell, cell, 4);
                ctx.fill();
            }
        }

        // 底部署名
        ctx.fillStyle = '#a0a5af';
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('专注钟 · 记录每一次专注', 300, 932);
        ctx.textAlign = 'left';
    },

    compactMinutes: function (text) {
        // 「2 小时 15 分钟」→「2小时15分」，适配卡片大字号
        return text.replace(/\s/g, '').replace('分钟', '分');
    },
});
