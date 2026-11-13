/**
 * 比赛结果确认状态机（纯函数，可单测，前端与云函数共用同一套规则）
 *
 * 每场比分记录 record（存于 rotation.scores['轮-场']）：
 * {
 *   sA, sB,                         // 双方得分
 *   status: 'pending'|'confirmed'|'disputed',
 *   required: [openid...],          // 需要确认本场结果的参与者（录入者除外）
 *   confirmedBy: [openid...],       // 已确认的参与者
 *   submittedBy: openid,            // 比分录入者（组织者）
 *   submittedAt, confirmedAt,
 *   dispute: { by, reason, at }     // 异议（有则存在）
 * }
 *
 * 规则：
 *  - 录入比分时，若场上存在"除录入者外、带 openid 的参与者"→ 进入待确认；否则直接确认（单机/手动名单降级）。
 *  - 全部 required 确认 → 已确认。
 *  - 任一参与者提出异议 → 争议态；争议态不会被其他人的确认自动解除，需组织者修改比分（重置）。
 */

const STATUS = { PENDING: 'pending', CONFIRMED: 'confirmed', DISPUTED: 'disputed' };

/** 一场比赛的参与者（teamA+teamB 去重）中带 openid 的列表 */
function matchParticipantOpenids(match, players) {
  const out = [];
  const seen = {};
  const m = match || {};
  (Array.isArray(m.teamA) ? m.teamA : []).concat(Array.isArray(m.teamB) ? m.teamB : []).forEach(i => {
    const p = players[i];
    const oid = p && p.openid;
    if (oid && !seen[oid]) {
      seen[oid] = true;
      out.push(oid);
    }
  });
  return out;
}

/** 需要确认本场的 openid：参与者中有 openid 者，排除录入者本人 */
function requiredOpenids(match, players, submitterOpenid) {
  return matchParticipantOpenids(match, players).filter(o => o !== submitterOpenid);
}

/**
 * 录入/修改比分时构造 record（修改比分会重置确认流程与异议）。
 * ctx: { match, players, submitterOpenid, now }
 */
function buildRecord(sA, sB, ctx) {
  const c = ctx || {};
  const now = c.now || Date.now();
  const required = requiredOpenids(c.match, c.players || [], c.submitterOpenid);
  const rec = {
    sA,
    sB,
    status: required.length ? STATUS.PENDING : STATUS.CONFIRMED,
    required,
    confirmedBy: [],
    submittedBy: c.submitterOpenid || '',
    submittedAt: now
  };
  if (!required.length) rec.confirmedAt = now;
  return rec;
}

/** 参与者确认比分；返回新 record（不可变更新） */
function confirm(record, openid, now) {
  if (!record || !openid) return record;
  if (record.status === STATUS.CONFIRMED) return record;
  if ((record.required || []).indexOf(openid) < 0) return record; // 非确认相关方
  const confirmedBy = (record.confirmedBy || []).slice();
  if (confirmedBy.indexOf(openid) < 0) confirmedBy.push(openid);
  const out = Object.assign({}, record, { confirmedBy });
  const all = (record.required || []).every(o => confirmedBy.indexOf(o) >= 0);
  // 争议态需组织者处理，不因凑齐确认而自动解除
  if (all && record.status !== STATUS.DISPUTED) {
    out.status = STATUS.CONFIRMED;
    out.confirmedAt = now || Date.now();
  }
  return out;
}

/** 参与者提出异议 */
function dispute(record, openid, reason, now) {
  if (!record || !openid) return record;
  if (!isParticipant(record, openid)) return record; // 非参与者不能提异议
  return Object.assign({}, record, {
    status: STATUS.DISPUTED,
    dispute: { by: openid, reason: reason || '', at: now || Date.now() }
  });
}

/** 是否满足「超时自动确认」：待确认、无异议、录入时间已达到超时时长 */
function shouldAutoConfirm(record, now, timeoutMs) {
  if (!record || record.status !== STATUS.PENDING) return false;
  if (record.dispute) return false; // 有异议不自动生效
  const submittedAt = record.submittedAt || 0;
  if (!submittedAt) return false;
  return (now - submittedAt) >= timeoutMs;
}

/** 执行自动确认：补齐所有 required 确认，标记 autoConfirmed（仍保留申诉窗口） */
function autoConfirm(record, now) {
  if (!record) return record;
  const t = now || Date.now();
  return Object.assign({}, record, {
    status: STATUS.CONFIRMED,
    confirmedBy: (record.required || []).slice(),
    confirmedAt: t,
    autoConfirmed: true
  });
}

/** 老数据自愈：无 status 的比分记录，已记分 → confirmed */
function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const out = Object.assign({}, record);
  if (!out.status) {
    const hasScore = (out.sA || out.sB) && !(out.sA === 0 && out.sB === 0);
    out.status = hasScore ? STATUS.CONFIRMED : STATUS.PENDING;
  }
  if (!Array.isArray(out.required)) out.required = [];
  if (!Array.isArray(out.confirmedBy)) out.confirmedBy = [];
  return out;
}

/** 该 openid 是否需要、且尚未确认本场 */
function canIConfirm(record, openid) {
  if (!openid || !record) return false;
  return record.status === STATUS.PENDING &&
    (record.required || []).indexOf(openid) >= 0 &&
    (record.confirmedBy || []).indexOf(openid) < 0;
}

/** 该 openid 是否为本场参与者（可确认/可提异议） */
function isParticipant(record, openid) {
  if (!openid || !record) return false;
  const all = (record.required || []).concat(record.submittedBy || []);
  return all.indexOf(openid) >= 0;
}

/** 汇总一个 rotation 已记分场次的确认状态计数 */
function summarize(rotation) {
  const s = { pending: 0, confirmed: 0, disputed: 0 };
  const scores = (rotation && rotation.scores) || {};
  Object.keys(scores).forEach(k => {
    const r = normalizeRecord(scores[k]);
    if (r.status === STATUS.PENDING) s.pending++;
    else if (r.status === STATUS.DISPUTED) s.disputed++;
    else s.confirmed++;
  });
  return s;
}

module.exports = {
  STATUS,
  matchParticipantOpenids,
  requiredOpenids,
  buildRecord,
  confirm,
  dispute,
  normalizeRecord,
  canIConfirm,
  isParticipant,
  shouldAutoConfirm,
  autoConfirm,
  summarize
};
