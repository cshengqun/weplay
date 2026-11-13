// pages/index/index.js
const store = require('../../utils/storage');
const cloud = require('../../utils/cloud');
const config = require('../../utils/config');

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

Page({
  onShareAppMessage() {
    return {
      title: '球局轮转：在线报名、双打/混双/单打轮转、记分排名',
      path: '/pages/index/index'
    };
  },
  data: {
    activities: [],
    activeList: [],
    historyList: [],
    version: config.version,
    loadError: '',
    loading: true
  },

  onShow() {
    this.load();
  },

  load(force) {
    // 1) 先用本地缓存秒开（不闪 loading、不跳屏）
    let localCards = [];
    try {
      const cached = Array.isArray(store.getActivities()) ? store.getActivities() : [];
      localCards = cached
        .filter(a => a && typeof a === 'object')
        .sort((a, b) => timeKey(b) - timeKey(a))
        .slice(0, 10)
        .map(buildCard)
        .filter(Boolean);
    } catch (e) {
      console.error('首页本地缓存渲染异常', e);
    }
    this.setData(Object.assign(groupCards(localCards), { loading: localCards.length === 0, loadError: '' }));

    // 2) 时间闸：15 秒内不重复拉云端（tab 来回切换不整页刷新）
    const now = Date.now();
    if (!force && this._lastFetch && now - this._lastFetch < 15000) return;
    this._lastFetch = now;

    // 3) 云端为权威：我创建的 + 我报名参加的球局都拉回来
    cloud.getHomeActivities()
      .then(res => {
        const cloudActs = (res && res.list) || [];
        const openid = (res && res.openid) || '';
        if (!cloudActs.length) {
          // 云端正常但没有球局 → 清空本地缓存显示（不读旧本地）
          try { store.saveActivities([]); } catch (e) {}
          this.setData({ activities: [], activeList: [], historyList: [], loadError: '', loading: false });
          return;
        }
        const list = cloudActs
          .filter(a => a && typeof a === 'object')
          .sort((a, b) => timeKey(b) - timeKey(a))
          .slice(0, 10)
          .map(a => ({
            id: a.id || 'cloud_' + a._id,
            cloudId: a._id,
            ownerOpenid: a._openid || '',
            isOwner: !!(openid && a._openid && a._openid === openid),
            name: a.name || '未命名球局',
            date: a.date || '',
            courts: a.courts || 1,
            startTime: a.startTime || '',
            durationHours: a.durationHours || 0,
            venue: a.venue || '',
            courtText: a.courtText || '',
            players: Array.isArray(a.players) ? a.players : [],
            rotations: (a.rotations && typeof a.rotations === 'object') ? a.rotations : { singles: null, doubles: null, mixed: null },
            createdAt: a.createdAt || Date.now()
          }));
        // 写本地仅作离线兜底缓存
        try { store.saveActivities(list); } catch (e) {}
        this.setData(Object.assign(groupCards(list.map(buildCard).filter(Boolean)), { loading: false }));
      })
      .catch(err => {
        console.warn('首页云端加载失败，保留本地缓存', err);
        this.setData({
          loading: false,
          loadError: localCards.length ? '' : '云端暂不可用，显示本地数据'
        });
      });
  },

  openActivity(e) {
    const ds = e.currentTarget.dataset;
    // 我创建的球局 → 进发起页编辑/记分；我参加的别人球局 → 进球局详情页
    if (ds.owner) {
      // create 是 tabBar 页面，不能带参数跳转：用 storage 传递待编辑球局 id
      try { wx.setStorageSync('weplay_edit_id', ds.id); } catch (e) {}
      wx.switchTab({ url: '/pages/create/create' });
    } else if (ds.cloud) {
      wx.navigateTo({ url: '/pages/join/join?id=' + ds.cloud });
    }
  },

  deleteActivity(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '该球局';
    wx.showModal({
      title: '删除球局',
      content: '确定删除「' + name + '」吗？报名名单和轮转记录将一并删除，且会同步删除云端数据（其他设备也将看不到）。',
      confirmColor: '#D64B4B',
      success: res => {
        if (res.confirm) {
          const act = store.getActivity(id);
          const cloudId = (act && act.cloudId) || '';
          const done = () => {
            store.deleteActivity(id);
            this.load(true);
            wx.showToast({ title: '已删除', icon: 'success' });
          };
          if (cloudId && cloud.isReady()) {
            // 先删云端（云端为唯一数据源），再删本地并刷新；非创建者云端拒绝则提示
            cloud.deleteActivity(cloudId).then(done).catch(err => {
              if (err && err.message === 'only-owner-can-delete') {
                wx.showToast({ title: '只有创建者能删除该球局', icon: 'none' });
              } else {
                done();
              }
            });
          } else {
            done();
          }
        }
      }
    });
  }
});

/** 比赛时间排序键：优先按日期+开始时间，缺失时退回创建时间 */
function timeKey(a) {
  const d = (a && a.date) || '';
  const t = (a && a.startTime) || '';
  if (d) {
    const ts = new Date(d.replace(/-/g, '/') + ' ' + t).getTime();
    if (!isNaN(ts)) return ts;
  }
  return (a && a.createdAt) || 0;
}

/** 把卡片分成「进行中」和「已结束」两组 */
function groupCards(cards) {
  const activeList = cards.filter(c => c && !c.done);
  const historyList = cards.filter(c => c && c.done);
  return {
    activities: cards,
    activeList,
    historyList
  };
}

/** 组装首页卡片数据（防御式） */
function buildCard(a) {
  if (!a || typeof a !== 'object') return null;
  const r = (a.rotations && typeof a.rotations === 'object') ? a.rotations : {};
  const badges = [];
  let badgeText = '待生成轮转';
  let done = false;
  const statuses = [];
  if (r.singles) { badges.push('单打'); statuses.push({ scored: countScored(r.singles), total: countTotal(r.singles) }); }
  if (r.doubles) { badges.push('双打'); statuses.push({ scored: countScored(r.doubles), total: countTotal(r.doubles) }); }
  if (r.mixed) { badges.push('混双'); statuses.push({ scored: countScored(r.mixed), total: countTotal(r.mixed) }); }
  if (statuses.length) {
    const allScored = statuses.reduce((s, x) => s + x.scored, 0);
    const allTotal = statuses.reduce((s, x) => s + x.total, 0);
    done = allScored > 0 && allScored === allTotal;
    badgeText = allScored === 0
      ? '已生成 · 待记分'
      : done
        ? '已完成 ' + allScored + '/' + allTotal + ' 场 · 看结果'
        : '已记 ' + allScored + '/' + allTotal + ' 场';
  }
  const players = Array.isArray(a.players) ? a.players : [];
  return {
    id: a.id,
    cloudId: a.cloudId || '',
    isOwner: !!a.isOwner,
    name: a.name || '未命名球局',
    date: a.date || '',
    startTime: a.startTime || '',
    endTime: endTime(a.startTime, a.durationHours),
    courts: a.courts || 1,
    venue: a.venue || '',
    courtText: a.courtText || '',
    count: players.length,
    badges,
    done,
    badgeText,
    badgeText2: badges.length ? badges.join(' · ') : ''
  };
}

/** 统计某轮转已填比分的场数（0:0 视为未记录） */
function countScored(rotation) {
  const sc = (rotation && rotation.scores && typeof rotation.scores === 'object') ? rotation.scores : {};
  return Object.keys(sc).filter(k => {
    const v = sc[k];
    return v && typeof v === 'object' && !(v.sA === 0 && v.sB === 0);
  }).length;
}

function countTotal(rotation) {
  const rounds = (rotation && Array.isArray(rotation.rounds)) ? rotation.rounds : [];
  return rounds.reduce((s, r) => s + (r && Array.isArray(r.matches) ? r.matches.length : 0), 0);
}
