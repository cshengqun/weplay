/**
 * 云开发封装（微信云开发 CloudBase，免服务器）
 *
 * 用途：球局创建后分享到微信群 → 他人点开分享卡片 → 云端读取球局信息 → 在线报名。
 * 未开通云开发时，本模块所有接口安全失败，小程序原有本地功能不受影响。
 *
 * 【写操作】报名 / 比分 / 确认 / 异议 / 更新 / 删除全部走 activity 云函数（服务端鉴权），
 * 客户端不再直写 activities 集合；集合权限设为「所有用户可读，仅创建者可读写」。
 *
 * 【开通步骤（必须本人操作）】
 * 1. 微信开发者工具 → 顶部工具栏点「云开发」→ 开通并创建环境（有免费额度）。
 * 2. 云开发控制台 → 数据库 → 新建集合，集合名必须为：activities（权限：所有用户可读，仅创建者可读写）。
 * 3. 部署 cloudfunctions/activity 云函数（右键 → 上传并部署，云端安装依赖）。
 * 4. 若开通了多个云环境，把环境 ID 填入下方 CLOUD_ENV；只有一个可留空（自动用默认环境）。
 */
const CLOUD_ENV = '';

let ready = null;

/** 初始化云（幂等）。返回是否可用 */
function isReady() {
  if (ready !== null) return ready;
  try {
    if (!wx.cloud) {
      ready = false;
      return ready;
    }
    wx.cloud.init({
      traceUser: true,
      ...(CLOUD_ENV ? { env: CLOUD_ENV } : {})
    });
    ready = true;
  } catch (e) {
    console.warn('云开发初始化失败', e);
    ready = false;
  }
  return ready;
}

function db() {
  return wx.cloud.database();
}

/** 姓名归一：去首尾及内部所有空白 + 小写，用于同名查重（“张三 ”/“张 三”/“Zhang”视为同一人） */
function normName(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, '').toLowerCase();
}

/** 递归清洗数据：移除 undefined 与 null 值（云数据库不接受，会导致整次写入失败） */
function cleanData(data) {
  if (Array.isArray(data)) {
    return data.map(v => (v && typeof v === 'object') ? cleanData(v) : v);
  }
  const out = {};
  Object.keys(data || {}).forEach(k => {
    const v = data[k];
    if (v === undefined || v === null) return;
    out[k] = (v && typeof v === 'object') ? cleanData(v) : v;
  });
  return out;
}

/**
 * 合并本地与云端的轮转快照（云端有内容用云端，云端为空但本地有时保留本地）。
 * 防止"云端旧数据覆盖本地刚生成的轮转"。
 */
function mergeRotations(local, cloud) {
  const out = { singles: null, doubles: null, mixed: null };
  ['singles', 'doubles', 'mixed'].forEach(k => {
    const l = (local || {})[k];
    const c = (cloud || {})[k];
    out[k] = (c && c.rounds) ? c : ((l && l.rounds) ? l : null);
  });
  return out;
}

/** 创建云端球局记录（客户端 add，_openid 自动注入），返回 _id */
async function createActivity(data) {
  if (!isReady()) throw new Error('云开发未开通');
  const r = await db().collection('activities').add({ data: cleanData(data) });
  return r._id;
}

/**
 * 统一调用 activity 云函数（所有写操作的唯一入口，服务端鉴权）。
 * 返回云函数 result（约定 { ok, msg, ... }）；未开通云开发时安全失败。
 */
function callActivity(action, payload) {
  if (!isReady()) return Promise.resolve({ ok: false, msg: '云开发未开通' });
  return wx.cloud
    .callFunction({ name: 'activity', data: Object.assign({ action }, payload || {}) })
    .then(r => (r && r.result) || { ok: false, msg: 'empty-result' })
    .catch(e => ({ ok: false, msg: (e && e.errMsg) || 'call-failed' }));
}

/** 更新云端球局（字段白名单，仅创建者，服务端校验） */
async function updateActivity(id, data) {
  const r = await callActivity('updateMeta', { cloudId: id, data });
  if (!r.ok) throw new Error(r.msg || 'update-failed');
  return true;
}

/** 删除云端球局（仅创建者，服务端校验） */
async function deleteActivity(id) {
  if (!isReady()) return;
  const r = await callActivity('delete', { cloudId: id });
  if (!r.ok) throw new Error(r.msg || 'delete-failed');
  return true;
}

/** 读取云端球局，不存在或异常返回 null */
async function getActivity(id) {
  if (!isReady() || !id) return null;
  try {
    const r = await db().collection('activities').doc(id).get();
    return r.data || null;
  } catch (e) {
    return null;
  }
}

/**
 * 拉取当前微信用户创建的全部云端球局（_openid 由云开发自动匹配当前用户）。
 * 用于清缓存/换设备后自动恢复：首页把云端数据合并回本地。
 */
async function getMyActivities() {
  if (!isReady()) return [];
  try {
    const r = await db()
      .collection('activities')
      .where({ _openid: '{openid}' })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return r.data || [];
  } catch (e) {
    console.warn('云端球局拉取失败', e && e.errMsg);
    return [];
  }
}

/**
 * 他人报名：走 activity 云函数（服务端 openid 查重 + 姓名查重）。
 * 返回 { ok, msg, players }
 */
async function pushPlayer(id, player) {
  const r = await callActivity('join', { cloudId: id, player });
  return { ok: !!r.ok, msg: r.msg || (r.ok ? '' : '报名失败'), players: r.players };
}

/** 组织者录入/修改比分（服务端重算确认方）。返回云函数 result */
function submitScore(cloudId, type, key, sA, sB) {
  return callActivity('saveScore', { cloudId, type, key, sA, sB });
}

/** 参与者确认本场比分 */
function confirmMatch(cloudId, type, key) {
  return callActivity('confirmMatch', { cloudId, type, key });
}

/** 参与者对本场比分提出异议 */
function disputeMatch(cloudId, type, key, reason) {
  return callActivity('disputeMatch', { cloudId, type, key, reason });
}

/**
 * 拉取当前用户报名过的云端球局（players 数组里 openid 匹配）。
 * 用于总榜：我创建的 + 我报名打过的球局都计入战绩。
 */
async function getJoinedActivities(openid) {
  if (!isReady() || !openid) return [];
  try {
    const r = await db()
      .collection('activities')
      .where({ 'players.openid': openid })
      .limit(50)
      .get();
    return r.data || [];
  } catch (e) {
    console.warn('报名球局拉取失败', e && e.errMsg);
    return [];
  }
}

/**
 * 首页用：合并「我创建的」+「我报名参加的」球局，按 _id 去重。
 * 返回 { list, openid }，openid 供首页判断每张卡片是否为本人创建。
 */
async function getHomeActivities() {
  if (!isReady()) return { list: [], openid: '' };
  const my = await getMyProfile().catch(() => null);
  const openid = (my && my.openid) || '';
  const mine = await getMyActivities().catch(() => []);
  let joined = [];
  if (openid) joined = await getJoinedActivities(openid).catch(() => []);
  const byId = {};
  (mine || []).forEach(a => { if (a && a._id) byId[a._id] = a; });
  (joined || []).forEach(a => { if (a && a._id && !byId[a._id]) byId[a._id] = a; });
  return { list: Object.keys(byId).map(k => byId[k]), openid };
}

/**
 * 拉取全部云端球局（分页，最多 500 条）。
 * 用于全局总榜：所有球局、所有球员的战绩汇总，所有人看到同一个榜。
 */
async function getAllActivities() {
  if (!isReady()) return [];
  // 小程序端单次 get 上限 20 条：先 count，再按 20/批并行拉取（5 个一组），最多 500 场
  const BATCH = 20;
  const MAX = 500;
  // 总榜只需要：球员身份字段（不带头像，省流量）+ 完整轮转（轮次/比分）
  const FIELD = {
    'players.name': true,
    'players.openid': true,
    'players.id': true,
    rotations: true
  };
  try {
    const c = await db().collection('activities').count();
    const total = Math.min(c.total || 0, MAX);
    const batchCount = Math.ceil(total / BATCH);
    const acts = [];
    for (let g = 0; g < batchCount; g += 5) {
      const group = [];
      for (let i = g; i < Math.min(g + 5, batchCount); i++) {
        group.push(
          db().collection('activities')
            .field(FIELD)
            .skip(i * BATCH)
            .limit(BATCH)
            .get()
            .then(r => r.data || [])
            .catch(() => [])
        );
      }
      const parts = await Promise.all(group);
      parts.forEach(p => acts.push(...p));
    }
    return acts;
  } catch (e) {
    console.warn('全局球局拉取失败', e && e.errMsg);
    return [];
  }
}

/**
 * 读取当前用户的云端档案（me 集合）。
 * me 集合安全规则请设为：{"read": "auth.openid == doc._openid", "write": "auth.openid == doc._openid"}
 * 该规则下 get() 只会返回本人创建的记录，_openid 由服务端自动注入。
 */
async function getMyProfile() {
  if (!isReady()) return null;
  try {
    const r = await db().collection('me').limit(1).get();
    const doc = r.data && r.data[0];
    if (!doc) return null;
    return {
      openid: doc._openid || '',
      name: doc.nickname || '',
      avatar: doc.avatar || '',
      gender: doc.gender || '',
      level: doc.level || ''
    };
  } catch (e) {
    return null;
  }
}

/** 保存当前微信用户云端档案（me 集合 upsert，不阻塞主流程） */
async function saveMyProfile(p) {
  if (!isReady() || !p) return false;
  try {
    const data = {
      nickname: p.name || '',
      avatar: p.avatar || '',
      gender: p.gender || '',
      level: p.level || '',
      updatedAt: Date.now()
    };
    const r = await db().collection('me').limit(1).get();
    if (r.data && r.data[0]) {
      await db().collection('me').doc(r.data[0]._id).update({ data });
    } else {
      await db().collection('me').add({ data });
    }
    return true;
  } catch (e) {
    return false;
  }
}

/** 上传头像到云存储，返回 fileID（cloud:// 永久地址，任何设备可见） */
function uploadAvatar(filePath) {
  if (!isReady() || !filePath) return Promise.reject(new Error('云开发未开通或路径为空白'));
  const ext = (filePath.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cloudPath =
    'avatars/' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '.' + (ext || 'png');
  return wx.cloud
    .uploadFile({ cloudPath, filePath })
    .then(res => ({ fileID: res.fileID }))
    .catch(err => {
      console.warn('头像上传失败', err);
      throw err;
    });
}

// ---------- 段位（rank 集合） ----------

/** 全国段位榜：rank 集合按综合 ELO 倒序，仅含已上榜者 */
async function getNationalBoard(limit) {
  if (!isReady()) return { ok: false, msg: '云开发未就绪' };
  try {
    const r = await db()
      .collection('rank')
      .where({ placed: true })
      .orderBy('combined', 'desc')
      .limit(limit || 50)
      .get();
    return { ok: true, list: r.data || [] };
  } catch (e) {
    return { ok: false, msg: (e && e.errMsg) || '排行榜加载失败' };
  }
}

/** 查询某人的段位档案 */
async function getRank(openid) {
  if (!isReady() || !openid) return { ok: false };
  try {
    const r = await db()
      .collection('rank')
      .where({ _openid: openid })
      .limit(1)
      .get();
    return { ok: true, rank: (r.data && r.data[0]) || null };
  } catch (e) {
    return { ok: false, msg: (e && e.errMsg) || '查询失败' };
  }
}

/** 历史回溯：全量重建段位（幂等，约数秒） */
async function backfillRank() {
  return callActivity('backfill', {});
}

module.exports = {
  normName,
  CLOUD_ENV,
  isReady,
  createActivity,
  updateActivity,
  deleteActivity,
  getActivity,
  getMyActivities,
  getJoinedActivities,
  getHomeActivities,
  getAllActivities,
  mergeRotations,
  pushPlayer,
  submitScore,
  confirmMatch,
  disputeMatch,
  uploadAvatar,
  getMyProfile,
  saveMyProfile,
  getNationalBoard,
  getRank,
  backfillRank
};
