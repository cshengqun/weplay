// pages/schedule/schedule.js
const store = require('../../utils/storage');
const score = require('../../utils/score');
const cloud = require('../../utils/cloud');
const cf = require('../../utils/confirm');

const TYPE_LABEL = { singles: '单打', doubles: '双打', mixed: '混双' };

/** 单场确认状态文案 */
function confirmText(rec) {
  if (rec.status === cf.STATUS.PENDING) {
    return '待确认 ' + (rec.confirmedBy || []).length + '/' + (rec.required || []).length;
  }
  if (rec.status === cf.STATUS.DISPUTED) return '比分有异议';
  return '已确认';
}

Page({
  data: {
    activityId: '',
    type: 'doubles',
    tabs: [],
    hasRotation: false,
    rotation: null,
    summary: null,
    rounds: [],
    stats: [],
    leaderboard: [],
    scoredInfo: { scored: 0, total: 0 },
    excludedNames: []
  },

  onShareAppMessage() {
    const act = store.getActivity(this.activityId);
    if (act && act.cloudId) {
      return {
        title: '看「' + (act.name || '球局') + '」比赛结果，战绩排名一目了然',
        path: '/pages/join/join?id=' + act.cloudId
      };
    }
    return { title: '球局轮转：报名、轮转、记分排名', path: '/pages/index/index' };
  },

  onLoad(options) {
    this.activityId = options.id || '';
    this.setData({ type: options.type || 'doubles' });
    // 组织者本人 openid：录入比分时作为 submitter，服务端据此计算需要谁确认
    cloud.getMyProfile().then(my => {
      this.myOpenid = (my && my.openid) || '';
    }).catch(() => { this.myOpenid = ''; });
  },

  onShow() {
    this.load();
  },

  load() {
    const act = store.getActivity(this.activityId);
    if (!act) return;
    const rotations = act.rotations || {};
    // 旧数据自愈：早期轮转快照漏存 avatar，按 id 从报名名单回填头像
    const byId = {};
    (act.players || []).forEach(p => { if (p && p.id) byId[p.id] = p; });
    let backfilled = false;
    ['singles', 'doubles', 'mixed'].forEach(md => {
      const rot = rotations[md];
      if (!rot || !Array.isArray(rot.players)) return;
      let changed = false;
      rot.players = rot.players.map(p => {
        const m = byId[p.id] || {};
        if (!p.avatar && m.avatar) { changed = true; return Object.assign({}, p, { avatar: m.avatar }); }
        return p;
      });
      if (changed) { backfilled = true; rot.players = rot.players.slice(); }
    });
    if (backfilled) {
      const all = store.getActivities();
      const idx = all.findIndex(a => a.id === this.activityId);
      if (idx >= 0) { all[idx] = act; store.saveActivities(all); }
    }
    const tabs = [
      { key: 'singles', label: '单打', exists: !!rotations.singles },
      { key: 'doubles', label: '双打', exists: !!rotations.doubles },
      { key: 'mixed', label: '混双', exists: !!rotations.mixed }
    ];
    this.setData({ tabs });
    this.render(rotations[this.data.type]);
    // 云端为权威（合并式）：云端有该类型轮转才覆盖；云端为空但本地有时保留本地，
    // 避免"云端旧数据覆盖本地刚生成的轮转"导致显示"还没有轮转"
    if (act.cloudId && cloud.isReady()) {
      cloud.getActivity(act.cloudId).then(ca => {
        if (!ca || typeof ca !== 'object') return;
        const merged = {
          ...ca,
          rotations: cloud.mergeRotations(rotations, ca.rotations),
          id: this.activityId,
          cloudId: ca._id,
          createdAt: ca.createdAt || act.createdAt
        };
        try {
          const all = store.getActivities();
          const idx = all.findIndex(a => a.id === this.activityId);
          if (idx >= 0) all[idx] = merged;
          store.saveActivities(all);
        } catch (e) {}
        const mr = merged.rotations || {};
        const mtabs = [
          { key: 'singles', label: '单打', exists: !!(mr.singles && mr.singles.rounds) },
          { key: 'doubles', label: '双打', exists: !!(mr.doubles && mr.doubles.rounds) },
          { key: 'mixed', label: '混双', exists: !!(mr.mixed && mr.mixed.rounds) }
        ];
        this.setData({ tabs: mtabs });
        const rot = mr[this.data.type];
        if (rot && rot.rounds) this.render(rot);
      }).catch(() => {});
    }
  },

  render(rotation) {
    if (!rotation) {
      this.setData({ hasRotation: false, rotation: null, rounds: [], stats: [], summary: null, excludedNames: [], leaderboard: [], scoredInfo: { scored: 0, total: 0 }, confirmed: false, targetScore: 0 });
      return;
    }
    // 确认状态：显式确认过，或已有比分记录（兼容旧数据）→ 视为已确定
    const sc = rotation.scores || {};
    const hasScored = Object.keys(sc).some(k => {
      const v = sc[k];
      return v && !(v.sA === 0 && v.sB === 0);
    });
    const confirmed = rotation.confirmed === true || hasScored;
    const targetScore = rotation.targetScore || 0;
    const players = rotation.players || [];
    const nameOf = i => (players[i] ? players[i].name : '球员' + (i + 1));
    const gMark = i => {
      const g = players[i] ? players[i].gender : '';
      return g === 'male' ? '男' : g === 'female' ? '女' : '';
    };
    const isMixed = this.data.type === 'mixed';
    const teamText = ids =>
      ids
        .map(i => (isMixed && gMark(i) ? nameOf(i) + '（' + gMark(i) + '）' : nameOf(i)))
        .join(' + ');
    const teamArr = ids =>
      (ids || []).map(i => ({
        name: nameOf(i),
        avatar: players[i] && players[i].avatar ? players[i].avatar : '',
        genderMark: isMixed && gMark(i) ? '（' + gMark(i) + '）' : ''
      }));

    const scores = rotation.scores || {};
    const excludedSet = new Set(rotation.excluded || []);
    const rounds = (rotation.rounds || []).map(r => {
      const waiting = (r.waiting || []).filter(i => !excludedSet.has(i));
      return {
        no: r.no,
        matches: (r.matches || []).map(m => {
          const key = score.matchKey(r.no, m.court);
          const sc = scores[key];
          const scored = !!(sc && !(sc.sA === 0 && sc.sB === 0));
          const aWin = scored && sc.sA > sc.sB;
          const bWin = scored && sc.sB > sc.sA;
          const rec = scored ? cf.normalizeRecord(sc) : null;
          return {
            court: m.court,
            key,
            teamA: teamArr(m.teamA),
            teamB: teamArr(m.teamB),
            sA: scored ? sc.sA : '',
            sB: scored ? sc.sB : '',
            scored,
            winnerA: aWin,
            winnerB: bWin,
            winnerText: scored ? (aWin ? teamText(m.teamA) : teamText(m.teamB)) + ' 胜' : '',
            cfStatus: rec ? rec.status : '',
            cfText: rec ? confirmText(rec) : ''
          };
        }),
        waiting: waiting.map(nameOf),
        hasWaiting: waiting.length > 0
      };
    });

    const stats = ((rotation.stats && rotation.stats.perPlayer) || []).map(p => ({
      name: p.name,
      plays: p.plays,
      hot: p.plays >= 4
    }));
    const max = stats.length ? Math.max(...stats.map(s => s.plays)) : 0;
    const min = stats.length ? Math.min(...stats.map(s => s.plays)) : 0;

    // 战绩榜
    const lb = score.computeLeaderboard(players, rotation.rounds, scores);
    const leaderboard = lb.leaderboard.map(p => ({
      idx: p.idx,
      rank: p.rank,
      name: p.name,
      avatar: p.avatar || '',
      plays: p.plays,
      wins: p.wins,
      losses: p.losses,
      winRateText: p.plays ? Math.round(p.winRate * 100) + '%' : '—',
      net: p.setWon - p.setLost
    }));

    this.setData({
      hasRotation: true,
      rotation,
      confirmed,
      targetScore,
      rounds,
      stats,
      leaderboard,
      cfSum: cf.summarize(rotation),
      scoredInfo: { scored: lb.scoredMatches, total: lb.totalMatches },
      excludedNames: (rotation.excluded || []).map(nameOf),
      summary: {
        courts: rotation.courts,
        totalRounds: rotation.totalRounds,
        totalMatches: rotation.totalMatches,
        mode: rotation.mode === 'custom' ? '自定义 ' + rotation.requestedRounds + ' 轮' : '全部组合',
        balance: stats.length
          ? min === max
            ? '每人 ' + min + ' 场'
            : '每人 ' + min + ' ~ ' + max + ' 场'
          : ''
      }
    });
  },

  /** 确认轮转：确认后锁定，只能录入比分，不能重新生成 */
  confirmRotation() {
    const act = store.getActivity(this.activityId);
    if (!act) return;
    const rotation = (act.rotations || {})[this.data.type];
    if (!rotation) return;
    rotation.confirmed = true;
    store.setRotation(this.activityId, this.data.type, rotation);
    this.syncCloud(rotation);
    this.render(rotation);
    wx.showToast({ title: '已确定，开始记分', icon: 'success' });
  },

  /** 记录/修改比分：输入双方实际得分（如 21:18），得分高者胜 */
  onNameTap(e) {
    const name = (e.currentTarget.dataset && e.currentTarget.dataset.name) || '';
    if (!name) return;
    wx.showModal({ title: '球员', content: name, showCancel: false, confirmText: '知道了' });
  },
  onScoreInput(e) {
    const { key, side } = e.currentTarget.dataset;
    let v = parseInt(e.detail.value, 10);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 999) v = 999;
    const rotation = this.data.rotation;
    if (!rotation) return;
    const scores = rotation.scores || {};
    const prev = cf.normalizeRecord(scores[key]);
    const a = side === 'A' ? v : (prev.sA || 0);
    const b = side === 'B' ? v : (prev.sB || 0);
    if (a === 0 && b === 0) {
      delete scores[key];
    } else {
      const match = this.findMatch(rotation, key);
      if (!match) return;
      // 本地乐观构造（录入者为组织者本人），单机模式下无 openid 即自动确认
      scores[key] = cf.buildRecord(a, b, {
        match,
        players: rotation.players || [],
        submitterOpenid: this.myOpenid || ''
      });
    }
    rotation.scores = scores;
    store.setRotation(this.activityId, this.data.type, rotation);
    this.render(rotation);
    this.syncScore(key, a, b);
  },

  /** 比分走云函数（服务端重算确认方），失败保留本地，下次进入以云端为准 */
  syncScore(key, a, b) {
    const act = store.getActivity(this.activityId);
    if (!act || !act.cloudId || !cloud.isReady()) return;
    cloud.submitScore(act.cloudId, this.data.type, key, a, b)
      .then(r => {
        if (!r.ok) { console.warn('云端比分同步失败', r.msg); return; }
        // 服务端状态与本地乐观状态不一致（确认人数差异）→ 重新拉取校正
        const local = cf.normalizeRecord((this.data.rotation.scores || {})[key]);
        if (r.status && r.status !== local.status) this.load();
      })
      .catch(e => console.warn('云端比分同步失败', e && e.errMsg));
  },

  /** 按 key 在轮转中找场次 */
  findMatch(rotation, key) {
    const rounds = (rotation && rotation.rounds) || [];
    for (let i = 0; i < rounds.length; i++) {
      const ms = Array.isArray(rounds[i].matches) ? rounds[i].matches : [];
      for (let j = 0; j < ms.length; j++) {
        if (score.matchKey(rounds[i].no, ms[j].court) === key) return ms[j];
      }
    }
    return null;
  },

  onTabTap(e) {
    const type = e.currentTarget.dataset.key;
    this.setData({ type });
    const act = store.getActivity(this.activityId);
    this.render(act ? (act.rotations || {})[type] : null);
  },

  regenerate() {
    wx.redirectTo({ url: '/pages/rotation/rotation?id=' + this.activityId + '&type=' + this.data.type });
  },

  clearRotation() {
    const label = TYPE_LABEL[this.data.type] || '';
    wx.showModal({
      title: '清空轮转',
      content: '确定清空已生成的' + label + '轮转表吗？',
      confirmColor: '#D64B4B',
      success: res => {
        if (res.confirm) {
          store.clearRotation(this.activityId, this.data.type);
          this.load();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
