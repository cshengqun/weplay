// pages/leaderboard/leaderboard.js
const cloud = require('../../utils/cloud');
const rank = require('../../utils/rank');

const TOP_N = 50; // 全国榜展示前 50 名
const CACHE_KEY = 'weplay_national_board_v1';
const CACHE_TTL = 10 * 60 * 1000;

Page({
  data: {
    list: [],
    myRank: null,
    empty: false,
    loadError: '',
    loading: true,
    backfilling: false
  },

  onLoad() {
    this.load(true);
  },

  onShow() {
    // 缓存秒开
    const c = this.readCache();
    if (c) this.apply(c, false);
  },

  onPullDownRefresh() {
    this.load(false).then(() => wx.stopPullDownRefresh());
  },

  readCache() {
    try {
      const c = wx.getStorageSync(CACHE_KEY);
      if (c && Date.now() - c.at < CACHE_TTL) return c.data;
    } catch (e) {}
    return null;
  },

  async load(allowCache) {
    if (allowCache) {
      const c = this.readCache();
      if (c) { this.apply(c, false); return; }
    }
    this.setData({ loading: true, loadError: '' });

    const r = await cloud.getNationalBoard(TOP_N);
    if (!r.ok) {
      const c = this.readCache();
      if (c) { this.apply(c, false); return; }
      this.setData({ loading: false, loadError: r.msg || '排行榜加载失败', empty: false });
      return;
    }

    // 我的段位
    let myView = null;
    const my = await cloud.getMyProfile();
    if (my && my.openid) {
      const rr = await cloud.getRank(my.openid);
      if (rr.rank) myView = this.buildMyView(rr.rank, my.name);
    }

    const data = { list: r.list || [], myRank: myView };
    this.apply(data, true);
  },

  /** 渲染并按需回写缓存 */
  apply(data, saveCache) {
    const list = (data.list || []).map((d, i) => this.buildRow(d, i + 1));
    this.setData({
      loading: false,
      loadError: '',
      list,
      myRank: data.myRank || null,
      empty: list.length === 0
    });
    if (saveCache) {
      try { wx.setStorageSync(CACHE_KEY, { at: Date.now(), data }); } catch (e) {}
    }
  },

  buildRow(d, no) {
    return Object.assign({
      rank: no,
      name: d.name || '球友',
      avatar: d.avatar || '',
      combined: d.combined
    }, this.rankView(d));
  },

  buildMyView(d, fallbackName) {
    return Object.assign({
      name: d.name || fallbackName || '我',
      avatar: d.avatar || '',
      combined: d.combined
    }, this.rankView(d));
  },

  /** 段位 / 星级 / 定级进度视图（rank 引擎为唯一口径） */
  rankView(d) {
    const counts = d.counts || {};
    const total = rank.MODES.reduce((s, m) => s + (counts[m] || 0), 0);
    const placed = rank.MODES.some(m => (counts[m] || 0) >= rank.PLACEMENT_MATCHES);

    if (!placed) {
      let best = 0;
      rank.MODES.forEach(m => { best = Math.max(best, counts[m] || 0); });
      return {
        placing: total > 0,
        tierName: total > 0 ? '定级中' : '未定级',
        subText: total > 0
          ? '定级赛 ' + Math.min(rank.PLACEMENT_MATCHES, best) + '/' + rank.PLACEMENT_MATCHES
          : '完成定级赛后上榜',
        starText: '',
        isKing: false
      };
    }

    const s = rank.starsOf(d.combined || rank.INITIAL_ELO);
    const isKing = s.tier.subdiv === 0;
    return {
      placing: false,
      tierName: isKing ? s.kingTitle : s.tier.name,
      tierKey: s.tier.key,
      subText: isKing ? s.kingTitle : s.subText,
      starText: s.starText,
      isKing
    };
  },

  onNameTap(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    wx.showModal({ title: '球员', content: name, showCancel: false });
  },

  /** 历史回溯：部署后首次使用、或数据异常时全量重建段位（幂等） */
  async onBackfill() {
    if (this.data.backfilling) return;
    const confirm = await new Promise(resolve => {
      wx.showModal({
        title: '重建全国段位榜',
        content: '将按所有已确认比赛重新计算段位，约需数秒，期间榜单可能短暂为空。',
        confirmText: '开始重建',
        success: r => resolve(!!r.confirm)
      });
    });
    if (!confirm) return;

    this.setData({ backfilling: true });
    wx.showLoading({ title: '回溯中…', mask: true });
    const r = await cloud.backfillRank();
    wx.hideLoading();
    this.setData({ backfilling: false });

    if (r.ok) {
      wx.showToast({ title: '已重建 ' + (r.players || 0) + ' 人', icon: 'success' });
      this.load(false);
    } else {
      wx.showToast({ title: r.msg || '回溯失败', icon: 'none' });
    }
  },

  onShareAppMessage() {
    return {
      title: '球局轮转 · 全国段位榜，看看你是什么羽',
      path: '/pages/leaderboard/leaderboard'
    };
  }
});
