// app.js
const cloud = require('./utils/cloud');

App({
  onLaunch() {
    // 首次启动初始化本地存储结构
    try {
      if (!wx.getStorageSync('weplay_activities_v2')) {
        wx.setStorageSync('weplay_activities_v2', []);
      }
    } catch (e) {
      console.error('存储初始化失败', e);
    }
    // 全局错误捕获：把真机报错写入本地，首页会展示出来，方便定位白屏
    try {
      wx.onError(err => {
        try { wx.setStorageSync('weplay_last_error', String(err).slice(0, 500)); } catch (e2) {}
      });
    } catch (e) {
      console.error('注册错误捕获失败', e);
    }
    // 初始化云开发（未开通时静默降级为本地模式）
    cloud.isReady();
    // 启动 3 秒后静默预取总榜（30 分钟内只刷一次），让排行榜页秒开
    setTimeout(() => {
      try {
        const CACHE_KEY = 'weplay_lb_cache_v1';
        const cache = wx.getStorageSync(CACHE_KEY);
        if (cache && cache.ts && Date.now() - cache.ts < 30 * 60 * 1000) return;
        if (!cloud.isReady()) return;
        const score = require('./utils/score');
        cloud.getAllActivities().then(acts => {
          const list = acts || [];
          const full = score.computeTotal(list).map(p => ({
            rank: p.rank,
            name: p.name,
            openid: p.openid || '',
            plays: p.plays,
            wins: p.wins,
            losses: p.losses,
            winRateText: p.plays ? Math.round(p.winRate * 100) + '%' : '—',
            net: p.setWon - p.setLost
          }));
          let totalGames = 0;
          list.forEach(a => {
            if (!a || typeof a !== 'object') return;
            ['singles', 'doubles', 'mixed'].forEach(m => {
              const rot = (a.rotations || {})[m];
              if (rot && rot.totalMatches) totalGames += rot.totalMatches;
            });
          });
          wx.setStorageSync(CACHE_KEY, { ts: Date.now(), total: full, activityCount: list.length, totalGames });
        }).catch(() => {});
      } catch (e) {}
    }, 3000);
  }
});
