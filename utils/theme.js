/**
 * 主题工具：管理全局深色/浅色模式。
 *
 * - 偏好存储在本地（键 focus_theme），三个页面共享；
 * - applySystemBars 把导航栏、tabBar、窗口背景色同步为当前主题；
 * - 页面样式通过 .container / .container.theme-dark 上的 CSS 变量切换。
 */
const KEY = 'focus_theme';

const LIGHT = {
    navFront: '#000000',
    navBg: '#ffffff',
    pageBg: '#f5f7fa',
    tabColor: '#9aa0a6',
    tabSelected: '#4f46e5',
    tabBg: '#ffffff',
    tabBorder: 'white',
};

const DARK = {
    navFront: '#ffffff',
    navBg: '#17181c',
    pageBg: '#17181c',
    tabColor: '#9aa0a6',
    tabSelected: '#818cf8',
    tabBg: '#202228',
    tabBorder: 'black',
};

function getTheme() {
    try {
        return wx.getStorageSync(KEY) === 'dark' ? 'dark' : 'light';
    } catch (e) {
        return 'light';
    }
}

function setTheme(theme) {
    try {
        wx.setStorageSync(KEY, theme === 'dark' ? 'dark' : 'light');
    } catch (e) {
        // 存储失败不影响本次会话的主题
    }
}

/**
 * 获取状态栏高度（px），供自定义导航栏让出系统状态栏区域。
 */
function statusBarHeight() {
    try {
        if (wx.getWindowInfo) {
            return wx.getWindowInfo().statusBarHeight || 20;
        }
    } catch (e) {
        // 继续降级
    }
    try {
        return wx.getSystemInfoSync().statusBarHeight || 20;
    } catch (e2) {
        return 20;
    }
}

/**
 * 同步系统栏配色（窗口背景 / tabBar），失败静默。
 * 注：已改用自定义导航栏（navigationStyle: custom），无需设置导航栏颜色。
 */
function applySystemBars(theme) {
    const c = theme === 'dark' ? DARK : LIGHT;
    try {
        wx.setBackgroundColor({
            backgroundColor: c.pageBg,
            fail: function () {},
        });
    } catch (e2) {
        // 忽略
    }
    try {
        wx.setTabBarStyle({
            color: c.tabColor,
            selectedColor: c.tabSelected,
            backgroundColor: c.tabBg,
            borderStyle: c.tabBorder,
            fail: function () {},
        });
    } catch (e3) {
        // 忽略
    }
}

/**
 * 页面 onShow 时调用：读取主题并写入页面 data.theme，同时同步系统栏。
 * 返回当前主题，方便页面做后续处理（如圆环重绘）。
 */
function applyToPage(page) {
    const theme = getTheme();
    if (page.data.theme !== theme) {
        page.setData({ theme: theme });
    }
    if (!page.data.statusBarHeight) {
        page.setData({ statusBarHeight: statusBarHeight() });
    }
    applySystemBars(theme);
    return theme;
}

module.exports = {
    getTheme: getTheme,
    setTheme: setTheme,
    statusBarHeight: statusBarHeight,
    applySystemBars: applySystemBars,
    applyToPage: applyToPage,
};
