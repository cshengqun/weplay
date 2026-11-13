/**
 * activity 云函数：球局所有「写操作」的统一入口（服务端鉴权 + 服务端状态机）
 *
 * 部署：微信开发者工具 → cloudfunctions/activity 右键 → 上传并部署（云端安装依赖）
 * 权限：activities 集合改为「所有用户可读，仅创建者可读写」；写操作全部经本函数（管理员权限）
 */
const cloud = require('wx-server-sdk');
const cf = require('./confirm');
const rank = require('./rank');
const notify = require('./notify');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'activities';

/** 超时自动确认：录入后 48h 未确认（且无异议）自动生效；只扫描近 10 天活动 */
const AUTO_CONFIRM_MS = 48 * 60 * 60 * 1000;
const SWEEP_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const SWEEP_MAX = 500;

/** 姓名归一：去所有空白 + 小写（与小程序端 cloud.normName 一致） */
function normName(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, '').toLowerCase();
}

/** 比赛标识（与 utils/score.matchKey 一致） */
function matchKey(roundNo, court) {
  return roundNo + '-' + court;
}

/** 按 key 在轮转中找到场次 */
function findMatch(rot, key) {
  const rounds = (rot && rot.rounds) || [];
  for (let i = 0; i < rounds.length; i++) {
    const ms = Array.isArray(rounds[i].matches) ? rounds[i].matches : [];
    for (let j = 0; j < ms.length; j++) {
      if (matchKey(rounds[i].no, ms[j].court) === key) return ms[j];
    }
  }
  return null;
}

/** 读取活动文档，不存在返回 null */
async function getDoc(cloudId) {
  if (!cloudId) return null;
  const r = await db.collection(COL).doc(cloudId).get().catch(() => null);
  return r && r.data ? r.data : null;
}

/** 取出某类型轮转（带防御） */
function getRotation(doc, type) {
  const rotations = doc.rotations || {};
  const rot = rotations[type];
  if (!rot || !Array.isArray(rot.rounds)) return null;
  if (!rot.scores) rot.scores = {};
  if (!Array.isArray(rot.players)) rot.players = [];
  return rot;
}

// ---------------- actions ----------------

/** 他人报名 */
async function join(event, openid) {
  const { cloudId, player } = event;
  const doc = await getDoc(cloudId);
  if (!doc) return { ok: false, msg: '球局不存在或已被删除' };
  const players = Array.isArray(doc.players) ? doc.players : [];
  if (openid && players.some(p => p.openid === openid)) {
    return { ok: false, msg: '你已报名过该球局，请勿重复提交', players };
  }
  const name = String((player && player.name) || '').trim();
  if (!name) return { ok: false, msg: '请输入姓名', players };
  if (players.some(p => normName(p.name) === normName(name))) {
    return { ok: false, msg: '该姓名已报名，请勿重复提交', players };
  }
  players.push({
    id: 'p' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    name,
    gender: (player && player.gender) || '',
    level: (player && player.level) || '',
    avatar: (player && player.avatar) || '',
    openid: openid || '',
    createdAt: Date.now()
  });
  await db.collection(COL).doc(cloudId).update({ data: { players } });
  return { ok: true, players };
}

/** 组织者录入/修改比分（服务端重算确认方，不信任客户端） */
async function saveScore(event, openid) {
  const { cloudId, type, key, sA, sB } = event;
  const doc = await getDoc(cloudId);
  if (!doc) return { ok: false, msg: '球局不存在或已被删除' };
  if (doc._openid && doc._openid !== openid) return { ok: false, msg: '只有组织者能录入比分' };
  const rotations = doc.rotations || {};
  const rot = getRotation(doc, type);
  if (!rot) return { ok: false, msg: '轮转不存在或尚未生成' };
  const scores = rot.scores || {};
  if (scores[key] && scores[key].settled) return { ok: false, msg: '比分已全部确认并锁定，无法修改' };
  const a = Number(sA) || 0;
  const b = Number(sB) || 0;
  if (a === 0 && b === 0) {
    delete scores[key];
  } else {
    const match = findMatch(rot, key);
    if (!match) return { ok: false, msg: '场次不存在' };
    scores[key] = cf.buildRecord(a, b, { match, players: rot.players, submitterOpenid: openid });
  }
  rot.scores = scores;
  rotations[type] = rot;
  await db.collection(COL).doc(cloudId).update({ data: { rotations } });
  const newRec = scores[key];
  if (newRec && newRec.status === cf.STATUS.PENDING) {
    // 通知待确认球友（data 字段需按申请到的真实模板字段补全）
    for (const oid of newRec.required || []) {
      await sendSub(oid, 'pendingConfirm', 'pages/join/join?id=' + cloudId, {});
    }
  }
  return { ok: true, status: (newRec && newRec.status) || '' };
}

/** 参与者确认比分 */
async function confirmMatch(event, openid) {
  const { cloudId, type, key } = event;
  const doc = await getDoc(cloudId);
  if (!doc) return { ok: false, msg: '球局不存在或已被删除' };
  const rot = getRotation(doc, type);
  if (!rot) return { ok: false, msg: '轮转不存在' };
  const record = cf.normalizeRecord(rot.scores[key]);
  if (!record || !(record.sA || record.sB)) return { ok: false, msg: '本场还未录入比分' };
  if (!cf.isParticipant(record, openid)) return { ok: false, msg: '你不是本场参与者' };
  const next = cf.confirm(record, openid);
  // 全部确认且尚未结算 → 触发 ELO 结算并锁定
  let changes = null;
  if (next.status === cf.STATUS.CONFIRMED && !next.settled) {
    changes = await settleConfirmedMatch(doc, type, key);
    next.settled = true;
  }
  rot.scores[key] = next;
  const rotations = doc.rotations || {};
  rotations[type] = rot;
  await db.collection(COL).doc(cloudId).update({ data: { rotations } });
  if (next.settled && Array.isArray(changes)) {
    // 通知上场队员段位已更新
    for (const oid of changes) {
      await sendSub(oid, 'settled', 'pages/leaderboard/leaderboard', {});
    }
  }
  return { ok: true, status: next.status, confirmedBy: next.confirmedBy, required: next.required, settled: !!next.settled, changes };
}

/** 参与者提出异议 */
async function disputeMatch(event, openid) {
  const { cloudId, type, key, reason } = event;
  const doc = await getDoc(cloudId);
  if (!doc) return { ok: false, msg: '球局不存在或已被删除' };
  const rot = getRotation(doc, type);
  if (!rot) return { ok: false, msg: '轮转不存在' };
  const record = cf.normalizeRecord(rot.scores[key]);
  if (!record || !(record.sA || record.sB)) return { ok: false, msg: '本场还未录入比分' };
  if (record.settled) return { ok: false, msg: '比分已全部确认并锁定' };
  if (!cf.isParticipant(record, openid)) return { ok: false, msg: '你不是本场参与者' };
  const next = cf.dispute(record, openid, reason);
  rot.scores[key] = next;
  const rotations = doc.rotations || {};
  rotations[type] = rot;
  await db.collection(COL).doc(cloudId).update({ data: { rotations } });
  if (doc._openid) {
    // 通知组织者有异议
    await sendSub(doc._openid, 'dispute', 'pages/schedule/schedule?id=' + cloudId, {});
  }
  return { ok: true, status: next.status };
}

/** 组织者更新球局信息/轮转（字段白名单） */
async function updateMeta(event, openid) {
  const { cloudId, data } = event;
  const doc = await getDoc(cloudId);
  if (!doc) return { ok: false, msg: '球局不存在或已被删除' };
  if (doc._openid && doc._openid !== openid) return { ok: false, msg: 'only-owner-can-edit' };
  const FIELDS = ['name', 'date', 'courts', 'startTime', 'durationHours', 'venue', 'courtText', 'players', 'rotations', 'done'];
  const patch = {};
  FIELDS.forEach(f => {
    if (data && data[f] !== undefined) patch[f] = data[f];
  });
  if (!Object.keys(patch).length) return { ok: false, msg: 'no-fields' };
  await db.collection(COL).doc(cloudId).update({ data: patch });
  return { ok: true };
}

/** 组织者删除球局 */
async function remove(event, openid) {
  const { cloudId } = event;
  const doc = await getDoc(cloudId);
  if (!doc) return { ok: true };
  if (doc._openid && doc._openid !== openid) return { ok: false, msg: 'only-owner-can-delete' };
  await db.collection(COL).doc(cloudId).remove().catch(() => null);
  return { ok: true };
}

// ---------------- 段位（rank 集合） ----------------

const RANK_COL = 'rank';

/** 写入/更新一份段位档案 */
async function upsertRank(profile) {
  const data = {
    name: profile.name || '',
    avatar: profile.avatar || '',
    elo: profile.elo,
    counts: profile.counts,
    combined: profile.combined,
    tier: profile.tier,
    tierName: profile.tierName,
    placed: !!profile.placed,
    updatedAt: profile.updatedAt || Date.now()
  };
  if (profile._id) {
    await db.collection(RANK_COL).doc(profile._id).update({ data }).catch(() => null);
    return;
  }
  const r = await db.collection(RANK_COL).where({ _openid: profile.openid }).limit(1).get().catch(() => ({ data: [] }));
  if (r.data && r.data[0]) {
    await db.collection(RANK_COL).doc(r.data[0]._id).update({ data });
  } else {
    await db.collection(RANK_COL).add({ data: Object.assign({ _openid: profile.openid }, data) });
  }
}

/** 从 rank 集合把档案读成 rank 引擎需要的结构 */
async function loadProfiles(oids) {
  const existing = {};
  for (let i = 0; i < oids.length; i++) {
    const oid = oids[i];
    const r = await db.collection(RANK_COL).where({ _openid: oid }).limit(1).get().catch(() => ({ data: [] }));
    if (r.data && r.data[0]) {
      const d = r.data[0];
      existing[oid] = {
        _id: d._id,
        openid: oid,
        name: d.name || '',
        avatar: d.avatar || '',
        elo: Object.assign({ singles: 1000, doubles: 1000, mixed: 1000 }, d.elo),
        counts: Object.assign({ singles: 0, doubles: 0, mixed: 0 }, d.counts),
        combined: d.combined || 1000,
        tier: d.tier,
        tierName: d.tierName,
        placed: d.placed
      };
    }
  }
  return existing;
}

/** 一场比赛全部确认后，结算 ELO 并回写所有上场有 openid 队员的段位 */
async function settleConfirmedMatch(doc, type, key) {
  const rot = getRotation(doc, type);
  const parts = String(key).split('-');
  const roundNo = Number(parts[0]);
  const court = Number(parts[1]);
  let match = null;
  (rot.rounds || []).forEach(r => {
    if (r.no === roundNo) {
      (r.matches || []).forEach(m => { if (m.court === court) match = m; });
    }
  });
  if (!match) return null;

  const oids = [];
  match.teamA.concat(match.teamB).forEach(idx => {
    const p = rot.players[idx];
    if (p && p.openid && oids.indexOf(p.openid) < 0) oids.push(p.openid);
  });

  const existing = await loadProfiles(oids);
  rank.settleOne(type, rot, match, roundNo, existing, Date.now());

  // 用快照补最新姓名/头像
  match.teamA.concat(match.teamB).forEach(idx => {
    const p = rot.players[idx];
    if (p && p.openid && existing[p.openid]) {
      existing[p.openid].name = p.name || existing[p.openid].name;
      existing[p.openid].avatar = p.avatar || existing[p.openid].avatar;
    }
  });

  for (let i = 0; i < oids.length; i++) await upsertRank(existing[oids[i]]);
  return oids;
}

/** 历史回溯：重放所有已确认比赛，全量重建 rank（幂等，可重复执行） */
async function backfill() {
  const all = [];
  const PAGE = 100;
  const MAX = 3000;
  let skip = 0;
  while (all.length < MAX) {
    const r = await db.collection(COL).orderBy('createdAt', 'asc').skip(skip).limit(PAGE).get();
    all.push.apply(all, r.data);
    if (r.data.length < PAGE) break;
    skip += PAGE;
  }

  const profiles = rank.replay(all, Date.now());

  // 补最新姓名/头像
  all.forEach(act => {
    rank.MODES.forEach(mode => {
      const rot = act.rotations && act.rotations[mode];
      if (!rot || !Array.isArray(rot.players)) return;
      rot.players.forEach(p => {
        if (p.openid && profiles[p.openid]) {
          profiles[p.openid].name = p.name || profiles[p.openid].name;
          profiles[p.openid].avatar = p.avatar || profiles[p.openid].avatar;
        }
      });
    });
  });

  const oids = Object.keys(profiles);
  for (let i = 0; i < oids.length; i++) await upsertRank(profiles[oids[i]]);
  return { activities: all.length, players: oids.length };
}

// ---------------- 订阅消息 ----------------

/** 发送订阅消息（模板未配置或发送失败时安全跳过，绝不影响主流程） */
async function sendSub(toOpenid, key, page, data) {
  const templateId = notify.TMPL[key];
  if (!templateId || !toOpenid) return false;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: toOpenid,
      templateId,
      page: page || 'pages/index/index',
      data: data || {},
      miniprogramState: 'formal'
    });
    return true;
  } catch (e) {
    console.warn('订阅消息发送失败', e && e.errMsg);
    return false;
  }
}

// ---------------- 定时：超时自动确认 ----------------

/** 拉取 createdAt 不早于 since 的活动（分页，上限 SWEEP_MAX） */
async function fetchRecentActivities(since) {
  const _ = db.command;
  const PAGE = 100;
  const out = [];
  let skip = 0;
  while (out.length < SWEEP_MAX) {
    const r = await db.collection(COL)
      .where({ createdAt: _.gte(since) })
      .orderBy('createdAt', 'asc')
      .skip(skip).limit(PAGE).get().catch(() => ({ data: [] }));
    out.push.apply(out, r.data);
    if (r.data.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

/** 定时触发器入口：扫描近窗活动，把超时（48h）无异议的待确认场次自动确认并结算 */
async function autoConfirmSweep() {
  const now = Date.now();
  const acts = await fetchRecentActivities(now - SWEEP_WINDOW_MS);
  let autoSettled = 0, disputedSkipped = 0, pendingLeft = 0;
  for (const act of acts) {
    let changed = false;
    for (const mode of rank.MODES) {
      const rot = act.rotations && act.rotations[mode];
      if (!rot || !rot.scores) continue;
      for (const key of Object.keys(rot.scores)) {
        const rec = cf.normalizeRecord(rot.scores[key]);
        if (rec.status !== cf.STATUS.PENDING) continue;
        if (rec.dispute) { disputedSkipped++; continue; }
        if (!cf.shouldAutoConfirm(rec, now, AUTO_CONFIRM_MS)) { pendingLeft++; continue; }
        rot.scores[key] = cf.autoConfirm(rec, now);
        await settleConfirmedMatch(act, mode, key);
        rot.scores[key].settled = true;
        changed = true;
        autoSettled++;
      }
    }
    if (changed) {
      await db.collection(COL).doc(act._id).update({ data: { rotations: act.rotations } }).catch(() => null);
    }
  }
  return { ok: true, scanned: acts.length, autoSettled, disputedSkipped, pendingLeft };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  const action = event.action;
  try {
    // 定时触发器触发（无用户 action）
    if (event.TriggerSource === 'timer') return await autoConfirmSweep();
    switch (action) {
      case 'join': return await join(event, openid);
      case 'saveScore': return await saveScore(event, openid);
      case 'confirmMatch': return await confirmMatch(event, openid);
      case 'disputeMatch': return await disputeMatch(event, openid);
      case 'updateMeta': return await updateMeta(event, openid);
      case 'delete': return await remove(event, openid);
      case 'backfill': {
        const r = await backfill();
        return { ok: true, ...r };
      }
      default: return { ok: false, msg: 'unknown-action' };
    }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || 'cloud-fn-error' };
  }
};
