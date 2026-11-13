// pages/rotation/rotation.js
const store = require('../../utils/storage');
const rot = require('../../utils/rotation');
const cloud = require('../../utils/cloud');

const TYPES = [
  { key: 'singles', label: '单打', desc: '两人一场，对手轮换' },
  { key: 'doubles', label: '双打', desc: '四人一场，搭档轮换' },
  { key: 'mixed', label: '混双', desc: '一男一女搭档' }
];

Page({
  data: {
    activityId: '',
    types: TYPES,
    type: 'doubles',
    courts: 2,
    customMode: false,
    customRounds: 4,
    playerCount: 0,
    maleCount: 0,
    femaleCount: 0,
    unknownCount: 0,
    generating: false,
    targetScore: 21,
    targetPresets: [11, 15, 21],
    targetInput: '',
    // 轮数规划
    durationHours: 2,
    perMatch: 15,
    perMatchOptions: [10, 15, 20, 25, 30],
    estRounds: 0,
    fairPeriod: 1,
    fairOptions: [],
    fairHint: '',
    timeNote: '',
    customRounds: 6
  },

  onShareAppMessage() {
    const act = store.getActivity(this.activityId);
    if (act && act.cloudId) {
      return {
        title: '「' + (act.name || '球局') + '」轮转表已出，点进来看你什么时候上场',
        path: '/pages/join/join?id=' + act.cloudId
      };
    }
    return { title: '球局轮转：报名、轮转、记分排名', path: '/pages/index/index' };
  },

  onLoad(options) {
    this.activityId = options.id || '';
    if (options.type) {
      this.setData({ type: options.type });
    }
    this.loadStats();
  },

  loadStats() {
    const act = store.getActivity(this.activityId);
    if (!act) {
      wx.showToast({ title: '球局不存在', icon: 'none' });
      return;
    }
    const players = act.players || [];
    const maleCount = players.filter(p => p.gender === 'male').length;
    const femaleCount = players.filter(p => p.gender === 'female').length;
    this.setData({
      courts: act.courts || 1,
      durationHours: act.durationHours || 2,
      playerCount: players.length,
      maleCount,
      femaleCount,
      unknownCount: players.length - maleCount - femaleCount
    }, () => this.updatePlan());
  },

  /**
   * 轮数规划：按"时长 + 每场用时"估算可打轮数，
   * 再落到"公平轮数"（该轮数下每人场次完全相同），供快捷选择。
   */
  updatePlan() {
    const n = this.data.type === 'mixed'
      ? this.data.maleCount + this.data.femaleCount
      : this.data.playerCount;
    const perRound = this.data.type === 'singles' ? 2 : 4;
    const c = Math.min(this.data.courts, Math.floor(n / perRound));
    if (c < 1) {
      this.setData({ fairOptions: [], fairPeriod: 1, estRounds: 0, timeNote: '人数不足以开赛' });
      return;
    }
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const period = n / gcd(n, perRound * c);
    const hours = this.data.durationHours || 2;
    const est = Math.floor((hours * 60) / this.data.perMatch);
    // 推荐轮数：不超过估算的最大公平轮数；时长不够打满一个周期时按估算（无法均等）
    let rec = Math.floor(est / period) * period;
    if (rec < period) rec = est < period ? Math.max(1, est) : period;
    const opts = [];
    for (let k = 1; k <= 3; k++) {
      const r = period * k;
      opts.push({ r, label: r + ' 轮', per: '每人 ' + Math.round((r * perRound * c) / n) + ' 场' });
    }
    const fair = rec >= period && rec % period === 0;
    this.setData({
      fairPeriod: period,
      estRounds: est,
      fairOptions: opts,
      customRounds: rec,
      timeNote: hours + ' 小时 × ' + this.data.perMatch + ' 分钟/场 ≈ 可打 ' + est + ' 轮',
      fairHint: fair
        ? '每 ' + period + ' 轮一个公平周期，每人场次完全相同'
        : '当前时长打不满一个公平周期（' + period + ' 轮），部分人可能少打 1 场'
    });
  },

  onTypeTap(e) {
    this.setData({ type: e.currentTarget.dataset.key }, () => this.updatePlan());
  },

  courtsMinus() {
    if (this.data.courts <= 1) return;
    this.setData({ courts: this.data.courts - 1 }, () => this.updatePlan());
  },

  courtsPlus() {
    if (this.data.courts >= 10) return;
    this.setData({ courts: this.data.courts + 1 }, () => this.updatePlan());
  },

  onPerMatch(e) {
    this.setData({ perMatch: Number(e.currentTarget.dataset.v) }, () => this.updatePlan());
  },

  onRoundPreset(e) {
    this.setData({ customRounds: Number(e.currentTarget.dataset.r) });
  },

  roundsMinus() {
    if (this.data.customRounds <= 1) return;
    this.setData({ customRounds: this.data.customRounds - 1 });
  },

  roundsPlus() {
    if (this.data.customRounds >= 30) return;
    this.setData({ customRounds: this.data.customRounds + 1 });
  },

  // ---------- 目标分数 ----------

  onTargetPreset(e) {
    const s = Number(e.currentTarget.dataset.score);
    this.setData({ targetScore: s, targetInput: '' });
  },

  onTargetInput(e) {
    const v = e.detail.value.replace(/\D/g, '').slice(0, 3);
    this.setData({ targetInput: v });
    if (v) this.setData({ targetScore: Number(v) });
  },

  onTargetCustom() {
    // 点击自定义框：聚焦输入由 onTargetInput 接管
  },

  onGenerate() {
    if (this.data.generating) return;
    const act = store.getActivity(this.activityId);
    if (!act) return;

    // 保护：该类型已有"已确定"的轮转时，不允许重新生成
    const existing = (act.rotations || {})[this.data.type];
    if (existing && existing.confirmed) {
      wx.showModal({
        title: '轮转已确定',
        content: '该轮转已经确定并开始记分，不能重新生成。如需新的玩法，请新建球局。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    this.doGenerate();
  },

  doGenerate() {
    const act = store.getActivity(this.activityId);
    if (!act) return;
    const players = act.players || [];

    const typeLabel = TYPES.find(t => t.key === this.data.type).label;
    if (players.length < 2) {
      wx.showToast({ title: '至少 2 人报名才能轮转', icon: 'none' });
      return;
    }
    if (this.data.type === 'doubles' && players.length < 4) {
      wx.showToast({ title: '双打至少需要 4 名球员', icon: 'none' });
      return;
    }
    if (this.data.type === 'mixed') {
      const m = players.filter(p => p.gender === 'male').length;
      const f = players.filter(p => p.gender === 'female').length;
      if (m < 2 || f < 2) {
        wx.showToast({ title: '混双至少需要 2 男 2 女，请先完善性别', icon: 'none' });
        return;
      }
    }

    this.setData({ generating: true });
    // 公平化：轮数 ≥ 公平周期且非周期倍数时，自动上调到最近公平轮数，保证每人场次相同
    const originalRounds = this.data.customRounds;
    let rounds = originalRounds;
    const period = this.data.fairPeriod || 1;
    if (rounds >= period && rounds % period !== 0) {
      rounds = Math.ceil(rounds / period) * period;
      this.setData({ customRounds: rounds });
    }
    const result = rot.generate(players, this.data.type, this.data.courts, rounds);
    this.setData({ generating: false });

    if (!result || !result.ok) {
      wx.showToast({ title: (result && result.error) || '生成失败', icon: 'none' });
      return;
    }

    // 均等校验：生成结果若与公平轮数不符则提示（如时长过短）
    const plays = (result.stats && result.stats.perPlayer || []).map(p => p.plays);
    const spread = plays.length ? Math.max(...plays) - Math.min(...plays) : 0;
    if (spread > 0) {
      wx.showToast({ title: '已生成，部分人少打 ' + spread + ' 场（时长不足）', icon: 'none' });
    } else if (rounds !== originalRounds) {
      wx.showToast({ title: '已调整为 ' + rounds + ' 轮，保证每人场次相同', icon: 'none' });
    }

    // 存入轮转快照（未确认：预览状态，确认后才可记分）
    result.players = players.map(p => ({ id: p.id, name: p.name, gender: p.gender || '', level: p.level || '', openid: p.openid || '', avatar: p.avatar || '' }));
    result.targetScore = this.data.targetScore || 21;
    result.confirmed = false;
    store.setRotation(this.activityId, this.data.type, result);

    // 同步轮转到云端（开通云开发后，任何设备可见）
    if (act && act.cloudId && cloud.isReady()) {
      cloud.updateActivity(act.cloudId, { rotations: act.rotations }).catch(() => {});
    }

    wx.redirectTo({
      url: '/pages/schedule/schedule?id=' + this.activityId + '&type=' + this.data.type
    });
  }
});
