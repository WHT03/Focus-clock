const dateUtil = require('../../utils/date');
const store = require('../../utils/store');
const themeUtil = require('../../utils/theme');

const PRESETS = [25, 45, 60];
const MIN_MIN = 1;
const MAX_MIN = 600;
const STEP = 5;
const TAGS = ['学习', '阅读', '工作', '运动'];
const STATE_KEY = 'focus_timer_state';
const MAX_RESTORE_SEC = 6 * 3600; // 状态恢复的最大时长上限（6 小时）
const REST_INTERVAL_SEC = 3600;   // 休息提醒间隔：每连续专注 1 小时提醒一次

Page({
    data: {
        theme: 'light',
        presets: PRESETS,
        tags: TAGS,
        selectedTag: TAGS[0],
        tagEditing: false,
        goalEditing: false,
        showTagInput: false,
        tagInputValue: '',
        selectedMin: 25,
        isCustom: false,
        isUnlimited: false,
        showGoalInput: false,
        goalInputValue: '',
        phase: 'idle', // idle | running | paused | done
        elapsedSec: 0,
        goalSec: 25 * 60,
        elapsedText: '00:00',
        reachedGoal: false,
        doneTitle: '',
        doneText: '',
        messageText: '',
        doneNote: '',
        noteSaved: false,
        savedRecordId: '',
        showAbortCard: false,
        abortInput: '',
        abortSaved: false,
        restHint: false,
        restHours: 0,
        fullscreen: false,
        fsShowExit: false,
        fsFontSize: '68px',
    },

    startTs: 0,
    reachedGoalNotified: false,
    restNotifiedCount: 0,
    restReminderOn: false,
    timerId: null,
    canvasNode: null,
    canvasCtx: null,
    canvasSize: 0,
    audioCtx: null,
    vibrateTimers: [],

    /**
     * 组装当前有效的标签列表：自带标签（剔除被删除的）+ 自定义标签。
     */
    buildTags: function () {
        const removed = store.getRemovedTags();
        const presets = TAGS.filter(function (t) {
            return removed.indexOf(t) === -1;
        });
        return presets.concat(store.getCustomTags());
    },

    /**
     * 组装当前有效的目标时长预设：自带预设（剔除被删除的）。
     */
    buildPresets: function () {
        const removed = store.getRemovedPresets();
        return PRESETS.filter(function (n) {
            return removed.indexOf(n) === -1;
        });
    },

    onReady: function () {
        this.initCanvas();
        // 有效标签 = 未被删除的自带标签 + 历史自定义标签
        const tags = this.buildTags();
        const patch = { tags: tags, presets: this.buildPresets() };
        // 上次选中的标签可能已被删除，回退到第一个可用标签
        if (tags.indexOf(this.data.selectedTag) === -1) {
            patch.selectedTag = tags[0] || '';
        }
        this.setData(patch);
    },

    onShow: function () {
        // 同步深色模式主题（圆环配色跟随变化）与休息提醒设置
        themeUtil.applyToPage(this);
        this.restReminderOn = store.getRestReminder();
        if (this.lastRing) {
            this.drawRing(this.lastRing.ratio, this.lastRing.reached);
        }
        // 从后台/其他页签回来时立即刷新计时并确保 tick 在跑
        if (this.data.phase === 'running') {
            if (this.timerId) {
                this.tick();
            } else {
                this.startTick();
            }
        }
    },

    onLoad: function () {
        // 读取休息提醒设置
        this.restReminderOn = store.getRestReminder();
        // 小程序被杀后重进：恢复进行中/暂停中的专注
        let state = null;
        try {
            state = wx.getStorageSync(STATE_KEY);
        } catch (e) {
            state = null;
        }
        if (!state) {
            return;
        }
        if (state.phase === 'running' && state.startTs) {
            // 隔了太久（>6 小时）的陈旧状态视为失效，避免把几十小时的“幽灵专注”保存进数据
            const staleSec = Math.round((Date.now() - state.startTs) / 1000);
            if (staleSec > MAX_RESTORE_SEC) {
                try {
                    wx.removeStorageSync(STATE_KEY);
                } catch (e2) {
                    // 忽略
                }
                this.setData({ messageText: '距上次专注间隔过久，未恢复上次计时' });
                return;
            }
            this.startTs = state.startTs;
            // 恢复时已累计的小时数：避免重进后立即重复触发休息提醒
            this.restNotifiedCount = Math.floor((Date.now() - state.startTs) / (REST_INTERVAL_SEC * 1000));
            this.setData({
                phase: 'running',
                isUnlimited: !!state.isUnlimited,
                isCustom: !!state.isCustom,
                selectedMin: state.selectedMin || 25,
                selectedTag: state.selectedTag || TAGS[0],
                goalSec: state.goalSec || 0,
                elapsedText: '00:00',
            });
            this.startTick();
        } else if (state.phase === 'paused') {
            this.setData({
                phase: 'paused',
                isUnlimited: !!state.isUnlimited,
                isCustom: !!state.isCustom,
                selectedMin: state.selectedMin || 25,
                selectedTag: state.selectedTag || TAGS[0],
                goalSec: state.goalSec || 0,
                elapsedSec: state.elapsedSec || 0,
                elapsedText: dateUtil.fmtClock(state.elapsedSec || 0),
            });
        }
    },

    /**
     * 把进行中/暂停中的专注持久化，供被杀后恢复；idle/done 时清除。
     */
    persistState: function () {
        const d = this.data;
        let state = null;
        if (d.phase === 'running') {
            state = {
                phase: 'running',
                startTs: this.startTs,
                goalSec: d.goalSec,
                isUnlimited: d.isUnlimited,
                isCustom: d.isCustom,
                selectedMin: d.selectedMin,
                selectedTag: d.selectedTag,
            };
        } else if (d.phase === 'paused') {
            state = {
                phase: 'paused',
                elapsedSec: d.elapsedSec,
                goalSec: d.goalSec,
                isUnlimited: d.isUnlimited,
                isCustom: d.isCustom,
                selectedMin: d.selectedMin,
                selectedTag: d.selectedTag,
            };
        }
        try {
            if (state) {
                wx.setStorageSync(STATE_KEY, state);
            } else {
                wx.removeStorageSync(STATE_KEY);
            }
        } catch (e) {
            // 持久化失败不影响正常使用
        }
    },

    onUnload: function () {
        this.stopTick();
        this.clearGoalNotify();
        if (this.audioCtx) {
            this.audioCtx.destroy();
            this.audioCtx = null;
        }
    },

    initCanvas: function () {
        const that = this;
        wx.createSelectorQuery()
            .select('#ring')
            .fields({ node: true, size: true })
            .exec(function (res) {
                if (!res || !res[0] || !res[0].node) {
                    return;
                }
                const canvas = res[0].node;
                const dpr = dateUtil.getPixelRatio();
                canvas.width = res[0].width * dpr;
                canvas.height = res[0].height * dpr;
                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                that.canvasNode = canvas;
                that.canvasCtx = ctx;
                that.canvasSize = res[0].width;
                // 暂停态恢复时把已有进度画回圆环，否则画空环
                if (that.data.phase === 'paused' && that.data.goalSec > 0) {
                    that.drawRing(that.data.elapsedSec / that.data.goalSec, that.data.elapsedSec >= that.data.goalSec);
                } else {
                    that.drawRing(0, false);
                }
            });
    },

    /**
     * 正向计时圆环：ratio = 已专注 / 目标，封顶 1；达标后变绿。
     * 配色跟随当前主题（深色模式底环和进度色都会变化）。
     */
    drawRing: function (ratio, reached) {
        this.lastRing = { ratio: ratio, reached: reached };
        const ctx = this.canvasCtx;
        const size = this.canvasSize;
        if (!ctx || !size) {
            return;
        }
        const dark = this.data.theme === 'dark';
        const baseColor = dark ? '#2e3138' : '#e8eaf2';
        const progressColor = dark ? '#818cf8' : '#4f46e5';
        const reachedColor = dark ? '#51cf66' : '#2f9e44';
        const c = size / 2;
        const lw = 12;
        const r = c - lw;
        ctx.clearRect(0, 0, size, size);
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        // 底环
        ctx.strokeStyle = baseColor;
        ctx.beginPath();
        ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.stroke();
        // 进度弧：从顶部顺时针增长
        if (ratio > 0) {
            ctx.strokeStyle = reached ? reachedColor : progressColor;
            ctx.beginPath();
            ctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ratio));
            ctx.stroke();
        }
    },

    onPresetTap: function (e) {
        // 编辑模式下点预设 chip 不切换，只能点 × 删除
        if (this.data.goalEditing || this.data.phase === 'running' || this.data.phase === 'paused') {
            return;
        }
        const min = Number(e.currentTarget.dataset.min);
        this.applyDuration(min, false);
    },

    /** 点「编辑预设 / 完成」：切换目标时长编辑态 */
    onToggleGoalEdit: function () {
        this.setData({
            goalEditing: !this.data.goalEditing,
            showGoalInput: false,
            goalInputValue: '',
            messageText: '',
        });
    },

    /** 编辑模式下点预设 chip 右上角 ×：删除该预设 */
    onPresetDelete: function (e) {
        if (!this.data.goalEditing) {
            return;
        }
        const min = Number(e.currentTarget.dataset.min);
        if (!min) {
            return;
        }
        const res = store.deletePreset(min);
        if (res.error) {
            this.setData({ messageText: res.error.message });
            return;
        }
        const patch = { presets: this.buildPresets(), messageText: '' };
        // 删掉的正好是当前选中值：转为自定义目标，保持数值不变
        if (this.data.selectedMin === min && !this.data.isCustom && !this.data.isUnlimited) {
            patch.isCustom = true;
        }
        this.setData(patch);
    },

    onStepMinus: function () {
        this.stepDuration(-STEP);
    },

    onStepPlus: function () {
        this.stepDuration(STEP);
    },

    stepDuration: function (delta) {
        if (this.data.phase === 'running' || this.data.phase === 'paused') {
            return;
        }
        const next = Math.min(MAX_MIN, Math.max(MIN_MIN, this.data.selectedMin + delta));
        this.applyDuration(next, true);
    },

    onTagTap: function (e) {
        // 编辑模式下点 chip 不切换选中，只能点 × 删除
        if (this.data.tagEditing || this.data.phase === 'running' || this.data.phase === 'paused') {
            return;
        }
        const tag = e.currentTarget.dataset.tag;
        if (tag) {
            this.setData({ selectedTag: tag });
        }
    },

    /** 点「编辑标签 / 完成」：切换标签编辑态 */
    onToggleTagEdit: function () {
        this.setData({
            tagEditing: !this.data.tagEditing,
            showTagInput: false,
            tagInputValue: '',
            messageText: '',
        });
    },

    /** 编辑模式下点 chip 右上角 ×：删除该标签（自带/自定义均可） */
    onTagDelete: function (e) {
        if (!this.data.tagEditing) {
            return;
        }
        const tag = e.currentTarget.dataset.tag;
        if (!tag) {
            return;
        }
        if (this.data.tags.length <= 1) {
            this.setData({ messageText: '至少保留一个标签' });
            return;
        }
        const res = store.deleteTag(tag);
        if (res.error) {
            this.setData({ messageText: res.error.message });
            return;
        }
        const tags = this.buildTags();
        const patch = { tags: tags, messageText: '' };
        if (this.data.selectedTag === tag) {
            patch.selectedTag = tags[0] || '';
        }
        this.setData(patch);
    },

    /** 点「＋ 自定义」chip：显示页内输入框 */
    onCustomTagTap: function () {
        if (this.data.phase === 'running' || this.data.phase === 'paused') {
            return;
        }
        this.setData({ showTagInput: true, tagInputValue: '', messageText: '' });
    },

    onTagInput: function (e) {
        this.setData({ tagInputValue: e.detail.value });
    },

    /** 键盘确认或失焦：保存标签并选中 */
    onTagConfirm: function () {
        if (!this.data.showTagInput) {
            return;
        }
        const raw = this.data.tagInputValue;
        const tag = String(raw || '').trim();
        if (!tag) {
            this.setData({ showTagInput: false, tagInputValue: '' });
            return;
        }
        if (tag.length > 6) {
            this.setData({ messageText: '标签最多 6 个字' });
            return;
        }
        const custom = store.getCustomTags();
        const removed = store.getRemovedTags();
        let tags = this.data.tags;
        if (tags.indexOf(tag) === -1 && custom.indexOf(tag) === -1) {
            if (removed.indexOf(tag) !== -1) {
                // 重新输入了之前删除的自带标签：恢复它
                const rr = store.restoreTag(tag);
                if (rr.error) {
                    this.setData({ messageText: rr.error.message });
                    return;
                }
                tags = this.buildTags();
            } else {
                const res = store.addCustomTag(tag);
                if (res.error) {
                    this.setData({ messageText: res.error.message });
                    return;
                }
                tags = this.buildTags();
            }
        }
        this.setData({
            tags: tags,
            selectedTag: tag,
            showTagInput: false,
            tagInputValue: '',
            showGoalInput: false,
            goalInputValue: '',
            doneNote: '',
            noteSaved: false,
            savedRecordId: '',
            showAbortCard: false,
            abortInput: '',
            abortSaved: false,
            restHint: false,
            restHours: 0,
            messageText: '',
        });
    },

    /** 点「取消」或输入框右侧 × ：收起输入框 */
    onTagCancel: function () {
        this.setData({ showTagInput: false, tagInputValue: '' });
    },

    /** 点「自定义」时长 chip：显示页内数字输入框 */
    onGoalCustomTap: function () {
        if (this.data.phase === 'running' || this.data.phase === 'paused') {
            return;
        }
        this.setData({ showGoalInput: true, goalInputValue: '', messageText: '' });
    },

    onGoalInput: function (e) {
        this.setData({ goalInputValue: e.detail.value });
    },

    /** 时长输入确认：校验 1~600 的整数后应用 */
    onGoalConfirm: function () {
        if (!this.data.showGoalInput) {
            return;
        }
        const raw = String(this.data.goalInputValue || '').trim();
        if (!raw) {
            this.setData({ showGoalInput: false, goalInputValue: '' });
            return;
        }
        const n = parseInt(raw, 10);
        if (isNaN(n) || String(n) !== raw || n < MIN_MIN || n > MAX_MIN) {
            this.setData({ messageText: '请输入 ' + MIN_MIN + ' ~ ' + MAX_MIN + ' 的整数分钟' });
            return;
        }
        this.setData({ showGoalInput: false, goalInputValue: '' });
        // 输入的是被删除的自带预设值：恢复为预设而不是自定义
        if (store.getRemovedPresets().indexOf(n) !== -1) {
            const rr = store.restorePreset(n);
            if (!rr.error) {
                this.setData({ presets: this.buildPresets() });
                this.applyDuration(n, false);
                return;
            }
        }
        this.applyDuration(n, true);
    },

    /** 收起时长输入框 */
    onGoalCancel: function () {
        this.setData({ showGoalInput: false, goalInputValue: '' });
    },

    /* ============ 本次专注描述 ============ */

    onNoteInput: function (e) {
        this.setData({ doneNote: e.detail.value });
    },

    /** 保存描述到刚结束的这条记录 */
    onSaveNote: function () {
        if (!this.data.savedRecordId) {
            return;
        }
        const text = String(this.data.doneNote || '').trim();
        if (!text) {
            this.setData({ messageText: '描述为空，可点「跳过」直接离开' });
            return;
        }
        const res = store.updateNote(this.data.savedRecordId, text);
        if (res.error) {
            this.setData({ messageText: '保存失败：' + res.error.message });
            return;
        }
        this.setData({ noteSaved: true, messageText: '' });
    },

    /** 跳过描述：收起输入卡 */
    onSkipNote: function () {
        this.setData({ savedRecordId: '', doneNote: '', noteSaved: false, messageText: '' });
    },

    /* ============ 未完成原因（未达目标就结束时填写） ============ */

    onAbortInput: function (e) {
        this.setData({ abortInput: e.detail.value });
    },

    /** 保存未完成原因到这条记录 */
    onSaveAbort: function () {
        if (!this.data.savedRecordId) {
            return;
        }
        const text = String(this.data.abortInput || '').trim();
        if (!text) {
            this.setData({ messageText: '原因不能为空，可点「跳过」不填' });
            return;
        }
        const res = store.updateAbortReason(this.data.savedRecordId, text);
        if (res.error) {
            this.setData({ messageText: '保存失败：' + res.error.message });
            return;
        }
        this.setData({ abortSaved: true, messageText: '' });
    },

    /** 跳过原因：收起输入卡 */
    onSkipAbort: function () {
        this.setData({ showAbortCard: false, abortInput: '', abortSaved: false, messageText: '' });
    },

    /* ============ 全屏专注模式（横屏适配） ============ */

    /** 获取窗口宽度（优先新接口，旧基础库降级） */
    windowWidth: function () {
        try {
            if (wx.getWindowInfo) {
                return wx.getWindowInfo().windowWidth || 375;
            }
        } catch (e0) {
            // 继续走降级
        }
        try {
            return wx.getSystemInfoSync().windowWidth || 375;
        } catch (e1) {
            return 375;
        }
    },

    /** 获取窗口高度（同上降级策略） */
    windowHeight: function () {
        try {
            if (wx.getWindowInfo) {
                return wx.getWindowInfo().windowHeight || 667;
            }
        } catch (e0) {
            // 继续走降级
        }
        try {
            return wx.getSystemInfoSync().windowHeight || 667;
        } catch (e1) {
            return 667;
        }
    },

    /** 计算全屏横排下的时间字号：横排可用宽度 = 视口高度 */
    calcFsFontSize: function () {
        const h = this.windowHeight();
        return Math.max(56, Math.round(h * 0.16)) + 'px';
    },

    /** 点「⛶ 全屏专注」：立刻以 CSS 旋转的方式横过来，并隐藏底部 tabBar */
    onFullscreenTap: function () {
        if (this.data.phase === 'done') {
            return;
        }
        this.setData({ fullscreen: true, fsShowExit: false, fsFontSize: this.calcFsFontSize() });
        try {
            wx.hideTabBar({ fail: function () {} });
        } catch (e0) {
            // 忽略
        }
        try {
            wx.setKeepScreenOn({ keepScreenOn: true, fail: function () {} });
        } catch (e) {
            // 忽略
        }
    },

    /** 全屏内点任意处：呼出/隐藏操作按钮 */
    onFsTap: function () {
        this.setData({ fsShowExit: !this.data.fsShowExit });
    },

    /** 退出全屏回到普通页面：恢复 tabBar */
    onFsExit: function () {
        this.setData({ fullscreen: false, fsShowExit: false });
        try {
            wx.showTabBar({ fail: function () {} });
        } catch (e0) {
            // 忽略
        }
        try {
            wx.setKeepScreenOn({ keepScreenOn: false, fail: function () {} });
        } catch (e) {
            // 忽略
        }
    },

    /** 全屏内直接结束：先退全屏再走正常结束保存流程 */
    onFsFinish: function () {
        this.onFsExit();
        this.onFinish();
    },

    /** 空处理：拦截全屏操作按钮区域的点击冒泡 */
    noop: function () {},

    /** 视口尺寸变化时重算全屏时间字号（预览窗口缩放等场景） */
    onResize: function () {
        if (this.data.fullscreen) {
            this.setData({ fsFontSize: this.calcFsFontSize() });
        }
    },

    applyDuration: function (min, isCustom) {
        this.stopTick();
        this.reachedGoalNotified = false;
        this.restNotifiedCount = 0;
        this.clearGoalNotify();
        this.setData({
            selectedMin: min,
            isCustom: isCustom,
            isUnlimited: false,
            phase: 'idle',
            elapsedSec: 0,
            goalSec: min * 60,
            elapsedText: '00:00',
            reachedGoal: false,
            doneText: '',
            doneTitle: '',
            messageText: '',
            showTagInput: false,
            tagInputValue: '',
            showGoalInput: false,
            goalInputValue: '',
            doneNote: '',
            noteSaved: false,
            savedRecordId: '',
            showAbortCard: false,
            abortInput: '',
            abortSaved: false,
            restHint: false,
            restHours: 0,
        });
        this.drawRing(0, false);
        this.persistState();
    },

    /**
     * 选择「不限时」：不设目标，纯正向计时，随时结束保存。
     */
    onUnlimitedTap: function () {
        if (this.data.phase === 'running' || this.data.phase === 'paused') {
            return;
        }
        this.stopTick();
        this.reachedGoalNotified = false;
        this.restNotifiedCount = 0;
        this.clearGoalNotify();
        this.setData({
            isUnlimited: true,
            isCustom: false,
            phase: 'idle',
            elapsedSec: 0,
            goalSec: 0,
            elapsedText: '00:00',
            reachedGoal: false,
            doneText: '',
            doneTitle: '',
            messageText: '',
            showTagInput: false,
            tagInputValue: '',
            showGoalInput: false,
            goalInputValue: '',
            doneNote: '',
            noteSaved: false,
            savedRecordId: '',
            showAbortCard: false,
            abortInput: '',
            abortSaved: false,
            restHint: false,
            restHours: 0,
        });
        this.drawRing(0, false);
        this.persistState();
    },

    onStart: function () {
        this.startTs = Date.now();
        this.reachedGoalNotified = false;
        this.restNotifiedCount = 0;
        this.clearGoalNotify();
        this.setData({
            phase: 'running',
            messageText: '',
            reachedGoal: false,
            showTagInput: false,
            tagInputValue: '',
            showGoalInput: false,
            goalInputValue: '',
            doneNote: '',
            noteSaved: false,
            savedRecordId: '',
            showAbortCard: false,
            abortInput: '',
            abortSaved: false,
            restHint: false,
            restHours: 0,
        });
        this.startTick();
        this.persistState();
    },

    onPause: function () {
        this.stopTick();
        const elapsed = Math.max(0, Math.round((Date.now() - this.startTs) / 1000));
        this.setData({ phase: 'paused', elapsedSec: elapsed, elapsedText: dateUtil.fmtClock(elapsed) });
        this.persistState();
    },

    onResume: function () {
        this.startTs = Date.now() - this.data.elapsedSec * 1000;
        this.setData({ phase: 'running' });
        this.startTick();
        this.persistState();
    },

    currentElapsed: function () {
        if (this.data.phase === 'running') {
            return Math.max(0, Math.round((Date.now() - this.startTs) / 1000));
        }
        return this.data.elapsedSec;
    },

    startTick: function () {
        const that = this;
        this.stopTick();
        this.tick();
        this.timerId = setInterval(function () {
            that.tick();
        }, 250);
    },

    stopTick: function () {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    },

    /**
     * 初始化达标提示音播放器（懒加载，只创建一次）。
     */
    ensureAudio: function () {
        if (this.audioCtx) {
            return;
        }
        try {
            const ctx = wx.createInnerAudioContext();
            ctx.src = '/assets/audio/goal-ding.wav';
            ctx.volume = 1;
            ctx.onError(function () {
                // 播放失败静默处理（个别环境不支持音频）
            });
            this.audioCtx = ctx;
        } catch (e) {
            this.audioCtx = null;
        }
    },

    /**
     * 清掉待触发的后续震动（结束/重置时调用）。
     */
    clearGoalNotify: function () {
        this.vibrateTimers.forEach(function (t) {
            clearTimeout(t);
        });
        this.vibrateTimers = [];
    },

    /**
     * 达标提醒：长震动 + 两次短震动 + 提示音（时间继续走，不打断专注）。
     */
    notifyGoalReached: function () {
        // 震动：真机生效；预览环境可能无感，但不会报错
        try {
            wx.vibrateLong({});
        } catch (e1) {
            // 忽略
        }
        const that = this;
        [500, 1000].forEach(function (delay) {
            that.vibrateTimers.push(setTimeout(function () {
                try {
                    wx.vibrateShort({ type: 'light' });
                } catch (e2) {
                    // 忽略
                }
            }, delay));
        });
        // 提示音
        this.ensureAudio();
        if (this.audioCtx) {
            try {
                this.audioCtx.stop();
                this.audioCtx.play();
            } catch (e3) {
                // 忽略
            }
        }
    },

    /**
     * 每小时休息提醒：震动 + 提示音 + 弹出休息横幅（计时继续，由用户决定是否暂停）。
     */
    notifyRest: function (count) {
        this.notifyGoalReached();
        this.setData({ restHint: true, restHours: count });
    },

    /** 休息横幅上的「暂停休息」：收起横幅并暂停计时 */
    onRestPause: function () {
        this.setData({ restHint: false });
        this.onPause();
    },

    /** 休息横幅上的「继续专注」：仅收起横幅，计时照常 */
    onRestDismiss: function () {
        this.setData({ restHint: false });
    },

    tick: function () {
        const elapsed = Math.max(0, Math.round((Date.now() - this.startTs) / 1000));
        const hasGoal = this.data.goalSec > 0;
        const reached = hasGoal && elapsed >= this.data.goalSec;
        if (elapsed !== this.data.elapsedSec || reached !== this.data.reachedGoal) {
            this.setData({
                elapsedSec: elapsed,
                elapsedText: dateUtil.fmtClock(elapsed),
                reachedGoal: reached,
            });
            // 不限时模式没有进度环，只在有限目标时重绘
            if (hasGoal) {
                this.drawRing(elapsed / this.data.goalSec, reached);
            }
            // 恰好达标时刻：震动 + 提示音 + 页面内提示（时间继续走）
            if (reached && !this.reachedGoalNotified) {
                this.reachedGoalNotified = true;
                this.notifyGoalReached();
                this.setData({ messageText: '已达目标 ' + this.data.selectedMin + ' 分钟，继续保持！' });
            }
            // 每小时休息提醒（累计专注时长，暂停期间不计入）
            if (this.restReminderOn) {
                const restCount = Math.floor(elapsed / REST_INTERVAL_SEC);
                if (restCount > this.restNotifiedCount) {
                    this.restNotifiedCount = restCount;
                    this.notifyRest(restCount);
                }
            }
        }
    },

    /**
     * 点击「结束」：自动保存本次已专注的时长（满 1 分钟才保存）。
     */
    onFinish: function () {
        this.stopTick();
        const elapsed = this.currentElapsed();
        if (elapsed < 60) {
            this.reachedGoalNotified = false;
        this.restNotifiedCount = 0;
        this.clearGoalNotify();
            this.setData({
                phase: 'idle',
                elapsedSec: 0,
                elapsedText: '00:00',
                reachedGoal: false,
                messageText: '本次专注不足 1 分钟，未保存',
                fullscreen: false,
                fsShowExit: false,
            });
            this.drawRing(0, false);
            this.persistState();
            return;
        }
        this.saveAndShowDone(elapsed);
    },

    saveAndShowDone: function (focusSec) {
        const unlimited = this.data.isUnlimited;
        const reached = unlimited ? true : focusSec >= this.data.goalSec;
        const res = store.create({
            date: dateUtil.todayStr(),
            startTs: Date.now() - focusSec * 1000,
            endTs: Date.now(),
            plannedMin: unlimited ? 0 : this.data.selectedMin,
            focusSec: focusSec,
            completed: reached,
            tag: this.data.selectedTag,
        });
        const focusText = dateUtil.fmtMinutes(focusSec / 60);
        const text = res.error
            ? '保存失败：' + res.error.message
            : '本次专注 ' + focusText + ' 已记录到今日打卡';
        this.reachedGoalNotified = false;
        this.restNotifiedCount = 0;
        this.clearGoalNotify();
        // 设定了目标但未达标就结束：弹出「未完成原因」输入卡
        const needAbortReason = !unlimited && !reached;
        this.setData({
            phase: 'done',
            doneTitle: unlimited ? '专注结束' : (reached ? '目标达成' : '专注已结束'),
            elapsedText: dateUtil.fmtClock(focusSec),
            doneText: text,
            messageText: '',
            savedRecordId: res.error ? '' : res.data.id,
            doneNote: '',
            noteSaved: false,
            showAbortCard: needAbortReason && !res.error,
            abortInput: '',
            abortSaved: false,
            restHint: false,
            restHours: 0,
            fullscreen: false,
            fsShowExit: false,
        });
        if (!unlimited) {
            this.drawRing(focusSec / this.data.goalSec, reached);
        }
        this.persistState();
    },

    onRestart: function () {
        // 完成态期间 canvas 已随 wx:else 卸载，回到 idle 后必须重新初始化
        this.canvasNode = null;
        this.canvasCtx = null;
        this.canvasSize = 0;
        if (this.data.isUnlimited) {
            this.onUnlimitedTap();
        } else {
            this.applyDuration(this.data.selectedMin, this.data.isCustom);
        }
        this.initCanvas();
    },

    onGoStats: function () {
        wx.switchTab({ url: '/pages/stats/stats' });
    },
});
