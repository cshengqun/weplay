// pages/join/join.js
// 他人通过分享卡片打开：
// - 球局未完成 → 查看球局信息 + 在线报名
// - 球局已完成 → 直接查看比赛结果（轮转表 + 战绩榜），任何设备可见
const cloud = require('../../utils/cloud');
const score = require('../../utils/score');
const cf = require('../../utils/confirm');
const notify = require('../../utils/notify');

/** 单场确认状态文案 */
function joinConfirmText(rec) {
  if (rec.status === cf.STATUS.PENDING) {
    return '待确认 ' + (rec.confirmedBy || []).length + '/' + (rec.required || []).length;
  }
  if (rec.status === cf.STATUS.DISPUTED) return '比分有异议';
  return '已确认';
}

// 水平：参照中羽在线评级（1~9 级）
const LEVELS = [
  { value: 'zy1', label: '中羽 1 级 · 零基础' },
  { value: 'zy2', label: '中羽 2 级 · 初学' },
  { value: 'zy3', label: '中羽 3 级 · 能对拉' },
  { value: 'zy4', label: '中羽 4 级 · 业余入门' },
  { value: 'zy5', label: '中羽 5 级 · 业余中级' },
  { value: 'zy6', label: '中羽 6 级 · 业余高级' },
  { value: 'zy7', label: '中羽 7 级 · 业余高手' },
  { value: 'zy8', label: '中羽 8 级 · 半专业' },
  { value: 'zy9', label: '中羽 9 级 · 专业' }
];
// 旧版（新手/进阶/高手）映射到中羽档位，兼容老数据
const LEGACY_LEVEL_MAP = { beginner: 'zy2', mid: 'zy5', pro: 'zy7' };
function levelText(v) {
  const hit = LEVELS.find(l => l.value === v);
  if (hit) return hit.label;
  if (LEGACY_LEVEL_MAP[v]) return LEVELS.find(l => l.value === LEGACY_LEVEL_MAP[v]).label;
  return '未设置';
}
/** 结束时间 = 开始时间 + 时长（小时） */
function endTime(start, hours) {
  if (!start || !hours) return '';
  const p = start.split(':').map(Number);
  if (p.length !== 2 || isNaN(p[0]) || isNaN(p[1])) return '';
  const total = p[0] * 60 + p[1] + Math.round(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
}
/** 报名页/结果页时间文案：如 2026-09-14 19:00 - 21:00 */
function timeTextOf(act) {
  const t = endTime(act.startTime, act.durationHours);
  if (act.startTime) return (act.date ? act.date + ' ' : '') + act.startTime + (t ? ' - ' + t : ' 开始');
  if (act.date) return act.date + (act.durationHours ? ' · 时长 ' + act.durationHours + ' 小时' : '');
  return '待定';
}

const RESULT_TYPES = [
  { key: 'singles', label: '单打' },
  { key: 'doubles', label: '双打' },
  { key: 'mixed', label: '混双' }
];

Page({
  data: {
    loading: true,
    error: '',
    cloudOk: false,
    activity: null,
    players: [],
    maleCount: 0,
    femaleCount: 0,
    isDone: false,
    results: [],
    // 报名表单
    newName: '',
    newGender: '',
    newLevel: '',
    newAvatar: '',
    nickFocus: false,
    levelIndex: 0,
    levelRange: LEVELS.map(l => l.label),
    submitting: false
  },

  onLoad(options) {
    this.cloudId = options.id || '';
    if (!this.cloudId) {
      this.setData({ loading: false, error: '分享链接无效，请让球局发起者重新分享' });
      return;
    }
    this.load();
  },

  /** 带出报名信息：云端 OpenID 档案优先，其次本地记忆 */
  applyProfile(profile) {
    if (!profile || !profile.name) return;
    const idx = profile.level ? LEVELS.findIndex(l => l.value === profile.level) : 0;
    this.setData({
      newName: profile.name,
      newAvatar: profile.avatar || '',
      newGender: profile.gender || '',
      newLevel: profile.level || '',
      levelIndex: idx >= 0 ? idx : 0
    });
  },

  async load() {
    this.setData({ loading: true, error: '' });
    const act = await cloud.getActivity(this.cloudId);
    if (!act) {
      this.setData({
        loading: false,
        error: '暂时无法读取球局信息：发起者可能未开通云端分享，或球局已被删除'
      });
      return;
    }
    const players = (act.players || []).map(p => ({
      id: p.id,
      name: p.name,
      gender: p.gender || '',
      genderText: p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未设置',
      levelText: levelText(p.level),
      avatar: p.avatar || ''
    }));
    // 云端 OpenID 档案（换设备也能带出）→ 无则本地记忆
    const my = await cloud.getMyProfile();
    this.myProfile = my;
    this.myOpenid = (my && my.openid) || '';
    if (my && my.name) {
      this.applyProfile(my);
    } else {
      try {
        this.applyProfile(wx.getStorageSync('weplay_my_profile'));
      } catch (e) {}
    }
    const maleCount = players.filter(p => p.gender === 'male').length;
    const femaleCount = players.filter(p => p.gender === 'female').length;
    // 解析比赛结果
    const results = this.buildResults(act.rotations || {}, act.players || []);
    const isDone = results.length > 0 && results.some(r => r.done);
    // 把云端球局并入本地存储（去重：同名且同日期跳过），让总榜统计到分享来的球局
    try {
      const acts = require('../../utils/storage').getActivities();
      const dup = acts.find(a => a.name === (act.name || '') && a.date === (act.date || ''));
      if (!dup) {
        require('../../utils/storage').upsertActivity({
          ...act,
          players: Array.isArray(act.players) ? act.players : [],
          rotations: (act.rotations && typeof act.rotations === 'object') ? act.rotations : { singles: null, doubles: null, mixed: null },
          id: act.id || 'cloud_' + this.cloudId,
          createdAt: act.createdAt || Date.now()
        });
      }
    } catch (e) {}
    this.setData({
      loading: false,
      cloudOk: true,
      activity: {
        name: act.name || '未命名球局',
        date: act.date || '',
        courts: act.courts || 1,
        startTime: act.startTime || '',
        durationHours: act.durationHours || 0,
        timeText: timeTextOf(act)
      },
      players,
      maleCount,
      femaleCount,
      results,
      totalPendingForMe: results.reduce((s, r) => s + (r.pendingForMe || 0), 0),
      progressText: results.filter(r => r.scored > 0 && !r.done)
        .map(r => r.label + ' 已记 ' + r.scored + '/' + r.total + ' 场')
        .join('；'),
      isDone
    });
    // 导航栏标题显示球局名称（替代全局的“球局轮转”）
    wx.setNavigationBarTitle({ title: act.name || '球局详情' });
  },

  /** 解析各类型轮转：比分进度 + 战绩榜 + 轮次对阵表（仅已确认的轮转） */
  buildResults(rotations, signupPlayers) {
    const results = [];
    // 旧数据自愈：早期轮转快照漏存 avatar，按 id 从报名名单回填（仅内存，不改云端）
    const byId = {};
    (signupPlayers || []).forEach(p => { if (p && p.id) byId[p.id] = p; });
    const backfill = rp =>
      (rp || []).map(p => {
        const m = byId[p.id] || {};
        return p.avatar ? p : Object.assign({}, p, { avatar: m.avatar || '' });
      });
    RESULT_TYPES.forEach(t => {
      const r = rotations[t.key];
      if (!r || !r.rounds) return;
      if (Array.isArray(r.players)) r.players = backfill(r.players);
      const hasScored = Object.keys(r.scores || {}).some(k => {
        const v = r.scores[k];
        return v && !(v.sA === 0 && v.sB === 0);
      });
      if (r.confirmed !== true && !hasScored) return; // 未确认的预览轮转不展示
      const pl = r.players || [];
      const nameOf = i => (pl[i] ? pl[i].name : '球员' + (i + 1));
      const isMixed = t.key === 'mixed';
      const teamArr = ids =>
        (ids || []).map(i => {
          const pp = pl[i] || {};
          const g = pp.gender || '';
          return {
            name: nameOf(i),
            avatar: pp.avatar || '',
            genderMark: isMixed && g ? (g === 'male' ? '（男）' : '（女）') : ''
          };
        });
      const lb = score.computeLeaderboard(pl, r.rounds, r.scores || {});
      const done = lb.scoredMatches > 0 && lb.scoredMatches === lb.totalMatches;
      const targetScore = r.targetScore || 0;
      // 推算当前轮：顺序找第一个"还有场次未记分"的轮次；全部记完则无当前轮
      const roundsArr = r.rounds || [];
      let cur = 1;
      for (let i = 0; i < roundsArr.length; i++) {
        const rr = roundsArr[i];
        const ms = Array.isArray(rr.matches) ? rr.matches : [];
        const allScored = ms.every(m => {
          const sc = (r.scores || {})[score.matchKey(rr.no, m.court)];
          return sc && !(sc.sA === 0 && sc.sB === 0);
        });
        if (!allScored) { cur = rr.no; break; }
        if (i === roundsArr.length - 1) cur = rr.no + 1;
      }
      const curRoundOk = !done && cur <= roundsArr.length;
      const onCourtNames = [];
      if (curRoundOk) {
        roundsArr.filter(rr => rr.no === cur).forEach(rr => {
          (Array.isArray(rr.matches) ? rr.matches : []).forEach(m => {
            [m.teamA, m.teamB].forEach(ids => {
              (ids || []).forEach(i => {
                const n = nameOf(i);
                if (onCourtNames.indexOf(n) === -1) onCourtNames.push(n);
              });
            });
          });
        });
      }
      const rounds = r.rounds.map(rr => ({
        no: rr.no,
        matches: (rr.matches || []).map(m => {
          const key = score.matchKey(rr.no, m.court);
          const sc = (r.scores || {})[key];
          const scored = !!(sc && !(sc.sA === 0 && sc.sB === 0));
          const rec = scored ? cf.normalizeRecord(sc) : null;
          const myOid = this.myOpenid;
          return {
            court: m.court,
            isCurrent: rr.no === cur,
            key,
            type: t.key,
            teamA: teamArr(m.teamA),
            teamB: teamArr(m.teamB),
            sA: scored ? sc.sA : '-',
            sB: scored ? sc.sB : '-',
            winnerA: scored && sc.sA > sc.sB,
            winnerB: scored && sc.sB > sc.sA,
            cfStatus: rec ? rec.status : '',
            cfText: rec ? joinConfirmText(rec) : '',
            canConfirm: rec ? cf.canIConfirm(rec, myOid) : false,
            iConfirmed: rec ? (rec.confirmedBy || []).indexOf(myOid) >= 0 : false,
            iInMatch: rec ? cf.isParticipant(rec, myOid) : false
          };
        })
      }));
      // 该类型中「待我确认」的场次数
      let pendingForMe = 0;
      rounds.forEach(rr => rr.matches.forEach(m => { if (m.canConfirm) pendingForMe++; }));
      results.push({
        type: t.key,
        label: t.label,
        scored: lb.scoredMatches,
        total: lb.totalMatches,
        done,
        pendingForMe,
        statusText: done ? '全部完成' : lb.scoredMatches > 0 ? '已记 ' + lb.scoredMatches + '/' + lb.totalMatches + ' 场' : '待记分',
        leaderboard: lb.leaderboard.map(p => ({
          idx: p.idx,
          rank: p.rank,
          name: p.name,
          avatar: p.avatar || '',
          plays: p.plays,
          wins: p.wins,
          losses: p.losses,
          winRateText: p.plays ? Math.round(p.winRate * 100) + '%' : '—',
          net: p.setWon - p.setLost
        })),
        targetScore,
        rounds,
        curRoundText: curRoundOk ? '第 ' + cur + ' / ' + roundsArr.length + ' 轮' : '',
        onCourtNamesText: onCourtNames.join('、')
      });
    });
    return results;
  },

  onNameTap(e) {
    const name = (e.currentTarget.dataset && e.currentTarget.dataset.name) || '';
    if (!name) return;
    wx.showModal({ title: '球员', content: name, showCancel: false, confirmText: '知道了' });
  },

  // ---------- 比赛结果确认 ----------

  /** 确认某场比分 */
  async onConfirmMatch(e) {
    const { type, key } = e.currentTarget.dataset;
    if (this._busy) return;
    this._busy = true;
    wx.showLoading({ title: '提交中' });
    const r = await cloud.confirmMatch(this.cloudId, type, key);
    wx.hideLoading();
    this._busy = false;
    if (r.ok) {
      wx.showToast({ title: '已确认', icon: 'success' });
      notify.requestSubs(['settled']);
      this.load();
    } else {
      wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
    }
  },

  /** 对某场比分提出异议（组织者会收到，需修改比分） */
  onDisputeMatch(e) {
    const { type, key } = e.currentTarget.dataset;
    wx.showModal({
      title: '比分有误？',
      editable: true,
      placeholderText: '请填写正确比分或问题',
      success: async res => {
        if (!res.confirm) return;
        if (this._busy) return;
        this._busy = true;
        wx.showLoading({ title: '提交中' });
        const r = await cloud.disputeMatch(this.cloudId, type, key, res.content || '');
        wx.hideLoading();
        this._busy = false;
        if (r.ok) {
          wx.showToast({ title: '已反馈给组织者', icon: 'success' });
          this.load();
        } else {
          wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
        }
      }
    });
  },

  // ---------- 报名表单（仅未完成时） ----------

  onNameInput(e) {
    this.setData({ newName: e.detail.value });
  },

  onGenderTap(e) {
    this.setData({ newGender: e.currentTarget.dataset.gender });
  },

  onLevelChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ newLevel: LEVELS[idx].value, levelIndex: idx });
  },

  onNickFocus() {
    this.setData({ nickFocus: true });
  },

  onNickBlur() {
    this.setData({ nickFocus: false });
  },

  /** 选择微信头像：本地预览并上传云存储（fileID 任何设备可见） */
  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl;
    if (!temp) return;
    this.setData({ newAvatar: temp });
    if (cloud.isReady()) {
      cloud
        .uploadAvatar(temp)
        .then(res => {
          if (res && res.fileID) this.setData({ newAvatar: res.fileID });
        })
        .catch(() => {});
    }
  },

  async submit() {
    if (this.data.submitting) return;
    const name = (this.data.newName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    // 提交前即时查重：同一微信或同名（忽略空格/大小写）不可重复报名
    const openid = (this.myProfile && this.myProfile.openid) || '';
    const dup = (this.data.players || []).some(p =>
      (openid && p.openid && p.openid === openid) ||
      cloud.normName(p.name) === cloud.normName(name));
    if (dup) {
      wx.showToast({ title: '你已报名过，请勿重复提交', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });
    const res = await cloud.pushPlayer(this.cloudId, {
      name,
      gender: this.data.newGender,
      level: this.data.newLevel,
      avatar: this.data.newAvatar,
      openid: (this.myProfile && this.myProfile.openid) || ''
    });
    wx.hideLoading();
    this.setData({ submitting: false });
    if (res.ok) {
      wx.showToast({ title: '报名成功', icon: 'success' });
      notify.requestSubs(['pendingConfirm', 'settled']);
      // 记住本次微信昵称/头像/性别/水平：写云端 me（换设备也自动带出）+ 本地兜底
      const profile = { name, avatar: this.data.newAvatar || '', gender: this.data.newGender || '', level: this.data.newLevel || '' };
      try {
        wx.setStorageSync('weplay_my_profile', profile);
      } catch (e) {}
      cloud.saveMyProfile(profile).catch(() => {});
      this.setData({ newName: '', newGender: '', newLevel: '', newAvatar: '', levelIndex: 0 });
      this.load();
    } else {
      wx.showToast({ title: res.msg || '报名失败', icon: 'none' });
      if (res.players) {
        this.renderPlayers(res.players);
      }
    }
  },

  renderPlayers(cloudPlayers) {
    const players = (cloudPlayers || []).map(p => ({
      id: p.id,
      name: p.name,
      gender: p.gender || '',
      genderText: p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未设置',
      levelText: levelText(p.level),
      avatar: p.avatar || ''
    }));
    const maleCount = players.filter(p => p.gender === 'male').length;
    const femaleCount = players.filter(p => p.gender === 'female').length;
    this.setData({ players, maleCount, femaleCount });
  },

  // ---------- 转发 ----------

  onShareAppMessage() {
    const name = this.data.activity ? this.data.activity.name : '球局';
    return {
      title: this.data.isDone
        ? '看「' + name + '」比赛结果，战绩排名一目了然'
        : '来报名「' + name + '」，一起打球！',
      path: '/pages/join/join?id=' + this.cloudId
    };
  }
});
