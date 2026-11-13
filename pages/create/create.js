// pages/create/create.js
const store = require('../../utils/storage');
const cloud = require('../../utils/cloud');
const score = require('../../utils/score');

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

// 24 小时制时间选择（避免 iOS 系统 12 小时制时出现上午/下午）
const HOURS = Array.from({ length: 24 }, (_, i) => (i < 10 ? '0' + i : '' + i));
const MINUTES = Array.from({ length: 60 }, (_, i) => (i < 10 ? '0' + i : '' + i));
function timeIndexOf(t) {
  const p = String(t || '19:00').split(':').map(Number);
  return [isNaN(p[0]) ? 19 : p[0], isNaN(p[1]) ? 0 : p[1]];
}

const RESULT_TYPES = [
  { key: 'singles', label: '单打' },
  { key: 'doubles', label: '双打' },
  { key: 'mixed', label: '混双' }
];

function today() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

Page({
  data: {
    isNew: true,
    activityId: '',
    name: '',
    date: '',
    courts: 1,
    startTime: '19:00',
    timeRange: [HOURS, MINUTES],
    timeIndex: [19, 0],
    durationHours: 2,
    durationOptions: [1, 1.5, 2, 2.5, 3, 3.5, 4],
    durationIndex: 2,
    players: [],
    maleCount: 0,
    femaleCount: 0,
    unknownCount: 0,
    cloudOn: false,
    cloudId: '',
    shareReady: false,
    results: [],
    resultsDone: false,
    isDone: false,
    hasRotation: false,
    // 添加球员表单
    newName: '',
    newGender: '',
    newLevel: '',
    newAvatar: '',
    nickFocus: false,
    levelIndex: 0,
    levelRange: LEVELS.map(l => l.label)
  },

  onLoad() {
    // 记住的微信昵称/头像/性别/水平自动带出（组织者添加自己报名时快捷）
    try {
      const profile = wx.getStorageSync('weplay_my_profile');
      if (profile && profile.name && !this.data.newName) {
        const idx = profile.level ? LEVELS.findIndex(l => l.value === profile.level) : 0;
        this.setData({
          newName: profile.name,
          newAvatar: profile.avatar || '',
          newGender: profile.gender || '',
          newLevel: profile.level || '',
          levelIndex: idx >= 0 ? idx : 0
        });
      }
    } catch (e) {}
    // 云端 OpenID 档案（异步覆盖，换设备也带出；用于组织者添加自己时绑定身份）
    cloud
      .getMyProfile()
      .then(my => {
        this.myProfile = my;
        if (my && my.name) {
          const idx = my.level ? LEVELS.findIndex(l => l.value === my.level) : 0;
          this.setData({
            newName: my.name,
            newAvatar: my.avatar || '',
            newGender: my.gender || '',
            newLevel: my.level || '',
            levelIndex: idx >= 0 ? idx : 0
          });
        }
      })
      .catch(() => {});
    // tabBar 化后首次进入：默认新建空表单（编辑/新建切换由 onShow 处理）
    this.initNewActivity();
    this.refreshPlayers();
  },

  /** 初始化一份新球局表单 */
  initNewActivity() {
    this.activity = {
      id: store.genId('act'),
      name: '',
      date: today(),
      courts: 1,
      startTime: '19:00',
      durationHours: 2,
      venue: '',
      courtText: '',
      createdAt: Date.now(),
      players: [],
      rotations: { singles: null, doubles: null, mixed: null }
    };
    this.setData({
      isNew: true,
      activityId: this.activity.id,
      name: '',
      date: this.activity.date,
      courts: 1,
      venue: '',
      courtText: '',
      startTime: '19:00',
      timeIndex: [19, 0],
      durationHours: 2,
      durationIndex: Math.max(0, this.data.durationOptions.indexOf(2)),
      players: [],
      cloudId: '',
      cloudOn: cloud.isReady()
    });
    this.updateShareReady();
  },

  /** 加载已有球局进行编辑（本地快照 + 云端权威合并） */
  loadForEdit(id) {
    const activity = store.getActivity(id);
    if (!activity) {
      this.initNewActivity();
      this.refreshPlayers();
      return;
    }
    this.activity = activity;
    this.applyActivity(activity);
    this.refreshPlayers();
    if (activity.cloudId && cloud.isReady()) {
      cloud.getActivity(activity.cloudId).then(ca => {
        if (!ca || typeof ca !== 'object') return;
        const merged = {
          ...ca,
          rotations: cloud.mergeRotations(activity.rotations, ca.rotations),
          id: activity.id,
          cloudId: ca._id,
          createdAt: ca.createdAt || activity.createdAt
        };
        this.activity = merged;
        try { store.upsertActivity(merged); } catch (e) {}
        this.applyActivity(merged);
        this.refreshPlayers();
      }).catch(() => {});
    }
  },

  /** 把球局信息渲染到页面（本地/云端共用） */
  applyActivity(activity) {
    const dur = activity.durationHours || 2;
    this.setData({
      isNew: false,
      activityId: activity.id,
      name: activity.name || '',
      date: activity.date || today(),
      courts: activity.courts || 1,
      venue: activity.venue || '',
      courtText: activity.courtText || '',
      startTime: activity.startTime || '19:00',
      timeIndex: timeIndexOf(activity.startTime),
      durationHours: dur,
      durationIndex: Math.max(0, this.data.durationOptions.indexOf(dur)),
      players: Array.isArray(activity.players) ? activity.players : [],
      cloudOn: cloud.isReady(),
      cloudId: activity.cloudId || ''
    });
    this.updateShareReady();
  },

  onShow() {
    // 从分享面板返回时 onShow 会触发，但编辑指令已消费：保持当前球局，仅静默刷新
    if (this._sharing) {
      this._sharing = false;
      this.refreshCloudRoster();
      this.loadResults();
      return;
    }
    // 从轮转/记分子页返回时保持当前球局；其他进入方式（点 tabBar、首页卡片/新建按钮）按指令切换
    const backFromSub = this.leavingToSub === true;
    this.leavingToSub = false;
    if (!backFromSub) {
      let editId = '';
      try { editId = wx.getStorageSync('weplay_edit_id') || ''; } catch (e) {}
      try { wx.removeStorageSync('weplay_create_mode'); } catch (e) {}
      if (editId) {
        try { wx.removeStorageSync('weplay_edit_id'); } catch (e) {}
        this.loadForEdit(editId);
      } else {
        // 点 tabBar「发起球局」或首页新建按钮：空表单（草稿不保留，已保存球局不受影响）
        this.initNewActivity();
        this.refreshPlayers();
      }
    }
    // 回到本页时，从云端拉取他人最新报名并合并；刷新比赛结果摘要
    this.refreshCloudRoster();
    this.loadResults();
  },

  /** 汇总各类型轮转的比赛结果摘要（仅统计已确认的轮转）。
   *  任一类型已全部记完比分 → 球局视为已完成（隐藏报名与生成入口） */
  loadResults() {
    const act = this.activity;
    const rotations = (act && act.rotations) || {};
    const results = [];
    RESULT_TYPES.forEach(t => {
      const r = rotations[t.key];
      // 未生成、或处于未确认的预览状态 → 不算比赛结果
      if (!r || !r.rounds) return;
      const hasScored = Object.keys(r.scores || {}).some(k => {
        const v = r.scores[k];
        return v && !(v.sA === 0 && v.sB === 0);
      });
      if (r.confirmed !== true && !hasScored) return;
      const lb = score.computeLeaderboard(r.players || [], r.rounds, r.scores || {});
      const done = lb.scoredMatches > 0 && lb.scoredMatches === lb.totalMatches;
      results.push({
        type: t.key,
        label: t.label,
        scored: lb.scoredMatches,
        total: lb.totalMatches,
        done,
        statusText: done
          ? '全部完成'
          : lb.scoredMatches > 0
            ? '已记 ' + lb.scoredMatches + '/' + lb.totalMatches + ' 场'
            : '待记分',
        top3: lb.leaderboard.slice(0, 3).map(p => ({ name: p.name, wins: p.wins }))
      });
    });
    const isDone = results.length > 0 && results.some(r => r.done);
    this.isDone = isDone;
    this.setData({
      results,
      isDone,
      hasRotation: results.length > 0,
      resultsDone: results.length > 0 && results.every(r => r.done)
    });
    // 完成态变化时同步到云端；同时把本地完整轮转（含比分）推上去，修复旧数据同步失败
    if (this.activity && this.activity.cloudId && cloud.isReady()) {
      cloud.updateActivity(this.activity.cloudId, {
        done: isDone,
        rotations: (this.activity.rotations || {})
      }).catch(e => console.warn('云端同步失败', e && e.errMsg));
    }
  },

  /** 进入某类型的比赛结果页 */
  goResult(e) {
    const type = e.currentTarget.dataset.type;
    this.leavingToSub = true;
    wx.navigateTo({ url: '/pages/schedule/schedule?id=' + this.activity.id + '&type=' + type });
  },

  /** 保存到本地存储 + 同步云端（首次修改时落库） */
  save() {
    store.upsertActivity(this.activity);
    this.syncCloud();
  },

  /** 分享按钮可用状态：球局已起名 + 云端记录已建立 + 云开发可用 */
  updateShareReady() {
    const ready = !!this.activity.name && !!this.activity.cloudId && cloud.isReady();
    if (this.data.shareReady !== ready) this.setData({ shareReady: ready });
  },

  /** 同步球局信息、名单、轮转与比分到云端（有名字后才建云端记录） */
  syncCloud() {
    if (!cloud.isReady()) return;
    const act = this.activity;
    if (!act.name) return;
    const data = {
      name: act.name,
      date: act.date || '',
      courts: act.courts || 1,
      startTime: act.startTime || '',
      durationHours: act.durationHours || 0,
      venue: act.venue || '',
      courtText: act.courtText || '',
      players: act.players || [],
      rotations: act.rotations || { singles: null, doubles: null, mixed: null },
      done: this.isDone
    };
    const done = () => {
      this.setData({ cloudOn: true, cloudId: act.cloudId || '' });
      this.updateShareReady();
    };
    if (act.cloudId) {
      cloud.updateActivity(act.cloudId, data).then(done).catch(e => console.warn('云端同步失败', e));
    } else {
      cloud.createActivity(data)
        .then(id => {
          act.cloudId = id;
          store.upsertActivity(act);
          done();
        })
        .catch(e => console.warn('云端同步失败', e));
    }
  },

  /** 拉取云端报名名单：以云端为权威覆盖本地（组织者的增删已在 save 时推送到云端） */
  refreshCloudRoster() {
    const act = this.activity;
    if (!act || !act.cloudId || !cloud.isReady()) return;
    cloud.getActivity(act.cloudId).then(ca => {
      if (!ca) return;
      const cloudPlayers = (ca.players || []).map(cp => ({
        id: cp.id || store.genId('p'),
        name: cp.name,
        gender: cp.gender || '',
        level: cp.level || ''
      }));
      const localIds = new Set((act.players || []).map(p => p.id));
      const changed =
        cloudPlayers.length !== (act.players || []).length ||
        cloudPlayers.some(cp => !localIds.has(cp.id));
      if (changed) {
        act.players = cloudPlayers;
        store.upsertActivity(act);
        this.refreshPlayers();
      }
    }).catch(() => {});
  },

  /** 刷新球员列表与统计 */
  refreshPlayers() {
    const players = (this.activity.players || []).map(p => ({
      id: p.id,
      name: p.name,
      gender: p.gender,
      genderText: p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未设置',
      levelText: levelText(p.level),
      avatar: p.avatar || ''
    }));
    const maleCount = players.filter(p => p.gender === 'male').length;
    const femaleCount = players.filter(p => p.gender === 'female').length;
    this.setData({
      players,
      maleCount,
      femaleCount,
      unknownCount: players.length - maleCount - femaleCount
    });
  },

  // ---------- 活动信息 ----------

  onNameInput(e) {
    this.activity.name = e.detail.value;
    this.setData({ name: e.detail.value });
    this.save();
    this.updateShareReady();
  },

  onVenueInput(e) {
    this.activity.venue = e.detail.value;
    this.setData({ venue: e.detail.value });
    this.save();
  },

  onCourtInput(e) {
    this.activity.courtText = e.detail.value;
    this.setData({ courtText: e.detail.value });
    this.save();
  },

  onDateChange(e) {
    this.activity.date = e.detail.value;
    this.setData({ date: e.detail.value });
    this.save();
  },

  onStartTimeChange(e) {
    const v = e.detail.value || [0, 0];
    const t = HOURS[v[0]] + ':' + MINUTES[v[1]];
    this.activity.startTime = t;
    this.setData({ startTime: t, timeIndex: [v[0], v[1]] });
    this.save();
  },

  onDurationChange(e) {
    const idx = Number(e.detail.value);
    const hours = this.data.durationOptions[idx];
    this.activity.durationHours = hours;
    this.setData({ durationHours: hours, durationIndex: idx });
    this.save();
  },

  courtsMinus() {
    if (this.activity.courts <= 1) return;
    this.activity.courts--;
    this.setData({ courts: this.activity.courts });
    this.save();
  },

  courtsPlus() {
    if (this.activity.courts >= 10) return;
    this.activity.courts++;
    this.setData({ courts: this.activity.courts });
    this.save();
  },

  /** 手动刷新云端报名 */
  refreshNow() {
    wx.showLoading({ title: '刷新中' });
    this.refreshCloudRoster();
    setTimeout(() => wx.hideLoading(), 600);
  },

  // ---------- 添加球员 ----------

  onNewNameInput(e) {
    this.setData({ newName: e.detail.value });
  },

  onGenderTap(e) {
    const gender = e.currentTarget.dataset.gender;
    this.setData({ newGender: gender });
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

  addPlayer() {
    const name = (this.data.newName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    const duplicate = (this.activity.players || []).some(p => cloud.normName(p.name) === cloud.normName(name));
    if (duplicate) {
      wx.showToast({ title: '该姓名已报名，请勿重复添加', icon: 'none' });
      return;
    }
    // 添加"自己"（昵称与当前微信档案一致）时绑定 OpenID，添加他人不绑定
    const isSelf =
      this.myProfile && this.myProfile.openid && cloud.normName(this.myProfile.name) === cloud.normName(name);
    this.activity.players.push({
      id: store.genId('p'),
      name,
      gender: this.data.newGender,
      level: this.data.newLevel,
      avatar: this.data.newAvatar,
      openid: isSelf ? this.myProfile.openid : ''
    });
    this.save();
    this.refreshPlayers();
    // 记住本次微信昵称/头像/性别/水平：写云端 me（换设备也自动带出）+ 本地兜底
    const profile = { name, avatar: this.data.newAvatar || '', gender: this.data.newGender || '', level: this.data.newLevel || '' };
    try {
      wx.setStorageSync('weplay_my_profile', profile);
    } catch (e) {}
    cloud.saveMyProfile(profile).catch(() => {});
    this.setData({ newName: '', newGender: '', newLevel: '', newAvatar: '', levelIndex: 0 });
  },

  removePlayer(e) {
    const id = e.currentTarget.dataset.id;
    this.activity.players = (this.activity.players || []).filter(p => p.id !== id);
    this.save();
    this.refreshPlayers();
  },

  clearPlayers() {
    wx.showModal({
      title: '清空名单',
      content: '确定清空全部报名吗？已生成的轮转不受影响。',
      confirmColor: '#D64B4B',
      success: res => {
        if (res.confirm) {
          this.activity.players = [];
          this.save();
          this.refreshPlayers();
        }
      }
    });
  },

  deleteActivity() {
    wx.showModal({
      title: '删除球局',
      content: '确定删除该球局吗？报名名单和轮转记录将一并删除。',
      confirmColor: '#D64B4B',
      success: res => {
        if (res.confirm) {
          const finishLocal = () => {
            store.deleteActivity(this.activity.id);
            this.initNewActivity();
            this.refreshPlayers();
            wx.switchTab({ url: '/pages/index/index' });
          };
          if (this.activity.cloudId) {
            cloud.deleteActivity(this.activity.cloudId).then(finishLocal).catch(err => {
              if (err && err.message === 'only-owner-can-delete') {
                wx.showToast({ title: '只有创建者能删除该球局', icon: 'none' });
              } else {
                finishLocal();
              }
            });
          } else {
            finishLocal();
          }
        }
      }
    });
  },

  // ---------- 分享 ----------

  /** 分享前检查云端状态 */
  onShareTap() {
    if (!cloud.isReady()) {
      wx.showToast({ title: '需先开通云开发才能分享，见 README', icon: 'none', duration: 2500 });
      return;
    }
    if (!this.activity.cloudId) {
      wx.showToast({ title: '请先给球局起名，稍后再分享', icon: 'none' });
      return;
    }
    // 分享面板即将弹出：关闭时会触发 onShow，打标记防止页面被重置成新建表单
    this._sharing = true;
  },

  onShareAppMessage() {
    const act = this.activity;
    if (!act || !act.cloudId) {
      return { title: '球局轮转', path: '/pages/index/index' };
    }
    // 覆盖按钮与右上角胶囊两个分享入口：面板关闭触发 onShow 时保持当前球局
    this._sharing = true;
    const t = endTime(act.startTime, act.durationHours);
    const timeText = act.startTime ? (t ? act.startTime + ' - ' + t : act.startTime + ' 开始') : '';
    const title = this.isDone
      ? '看「' + (act.name || '球局') + '」比赛结果，战绩排名一目了然'
      : '来报名「' + (act.name || '球局') + '」' + (act.date ? act.date + ' ' : '') + timeText + '，一起打球！';
    return {
      title,
      path: '/pages/join/join?id=' + act.cloudId
    };
  },

  // ---------- 跳转 ----------

  /** 无轮转 → 去生成；已有确认轮转 → 去查看/录入比分 */
  goRotation() {
    const act = this.activity;
    if (!act) return;
    // 新建球局可能尚未落库：先保存（本地 + 云端），确保轮转页能读到报名名单
    this.save();
    const rotations = (act && act.rotations) || {};
    const first = RESULT_TYPES.find(t => {
      const r = rotations[t.key];
      if (!r || !r.rounds) return false;
      const hasScored = Object.keys(r.scores || {}).some(k => {
        const v = r.scores[k];
        return v && !(v.sA === 0 && v.sB === 0);
      });
      return r.confirmed === true || hasScored;
    });
    if (first) {
      this.leavingToSub = true;
      wx.navigateTo({ url: '/pages/schedule/schedule?id=' + act.id + '&type=' + first.key });
    } else {
      this.leavingToSub = true;
      wx.navigateTo({ url: '/pages/rotation/rotation?id=' + act.id });
    }
  }
});
