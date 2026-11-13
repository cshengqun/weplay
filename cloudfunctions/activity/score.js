/**
 * 比分记录与战绩排名计算
 *
 * 计分规则：
 *  - 每场比赛记录两队各自得分（如 21:18），得分多者胜；
 *  - 战绩榜：统计每人 场次 / 胜场 / 负场 / 胜率 / 净胜分；
 *  - 排名：胜场 > 胜率（并列同 rank）；
 *  - 双打/混双按"个人"累计（轮转中搭档轮换，战绩归属个人）。
 */

/** 比赛标识：轮次号-场地号 */
function matchKey(roundNo, court) {
  return roundNo + '-' + court;
}

/**
 * 计算单个球局战绩榜
 * @param {Array} players 轮转快照 [{name, ...}]
 * @param {Array} rounds 轮次 [{no, matches:[{court, teamA:[], teamB:[]}]}]
 * @param {Object} scores 比分记录 { '1-1': {sA, sB}, ... }（0:0 视为未记录）
 * @returns {{leaderboard: Array, totalMatches: number, scoredMatches: number}}
 */
function computeLeaderboard(players, rounds, scores) {
  const list = (players || []).map((p, i) => {
    const safe = (p && typeof p === 'object') ? p : {};
    return {
      idx: i,
      name: safe.name || ('球员' + (i + 1)),
      openid: safe.openid || '',
      avatar: safe.avatar || '',
      plays: 0,
      wins: 0,
      losses: 0,
      setWon: 0,
      setLost: 0,
      winRate: 0
    };
  });
  const scoreMap = scores || {};
  let totalMatches = 0;
  let scoredMatches = 0;

  (rounds || []).forEach(r => {
    if (!r || typeof r !== 'object') return; // 防御异常轮次
    const ms = Array.isArray(r.matches) ? r.matches : [];
    ms.forEach(m => {
      if (!m || typeof m !== 'object') return; // 防御异常场次
      totalMatches++;
      const sc = scoreMap[matchKey(r.no, m.court)];
      if (!sc || typeof sc !== 'object' || (sc.sA === 0 && sc.sB === 0)) return; // 未记录
      const aWin = sc.sA > sc.sB;
      const bWin = sc.sB > sc.sA;
      if (aWin === bWin) return; // 无效比分（同分）不计
      const ta = Array.isArray(m.teamA) ? m.teamA : [];
      const tb = Array.isArray(m.teamB) ? m.teamB : [];

      scoredMatches++;
      [ta, tb].forEach((ids, side) => {
        const win = side === 0 ? aWin : bWin;
        const sWon = side === 0 ? sc.sA : sc.sB;
        const sLost = side === 0 ? sc.sB : sc.sA;
        ids.forEach(i => {
          const p = list[i];
          if (!p) return;
          p.plays++;
          if (win) {
            p.wins++;
          } else {
            p.losses++;
          }
          p.setWon += sWon;
          p.setLost += sLost;
        });
      });
    });
  });

  list.forEach(p => {
    p.winRate = p.plays ? p.wins / p.plays : 0;
  });

  // 排序：胜场 > 胜率 > 姓名
  list.sort((a, b) => (
    b.wins - a.wins ||
    b.winRate - a.winRate ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ));

  // 名次（胜场与胜率都相同则并列同 rank）
  let rank = 0;
  let prevKey = null;
  list.forEach((p, i) => {
    const key = p.wins + '|' + p.winRate.toFixed(6);
    if (key !== prevKey) rank = i + 1;
    p.rank = rank;
    prevKey = key;
  });

  return { leaderboard: list, totalMatches, scoredMatches };
}

/**
 * 计算跨球局总榜：汇总本地全部球局已录比分的战绩，按名字聚合。
 * @param {Array} activities 本地球局列表
 * @returns {Array} [{ rank, name, plays, wins, losses, winRate, setWon, setLost }]
 */
function computeTotal(activities) {
  const map = {};
  const order = [];
  const modes = ['singles', 'doubles', 'mixed'];
  (activities || []).forEach(act => {
    if (!act || typeof act !== 'object') return; // 防御异常数据
    // 头像回填：早期轮转快照漏存 avatar，按 id 从报名名单补（内存，不改原数据）
    const byId = {};
    const byOpenid = {};
    const byName = {};
    (act.players || []).forEach(p => {
      if (!p) return;
      if (p.id) byId[p.id] = p;
      if (p.openid) byOpenid[p.openid] = p;
      if (p.name && !byName[p.name]) byName[p.name] = p;
    });
    const avatarOf = p => {
      if (!p) return '';
      const m = (p.id && byId[p.id]) || (p.openid && byOpenid[p.openid]) || (p.name && byName[p.name]) || {};
      return m.avatar || '';
    };
    const playersOf = rot => {
      const rp = rot.players || [];
      if (!rp.length) return rp;
      const need = rp.some(p => p && !p.avatar && avatarOf(p));
      if (!need) return rp;
      return rp.map(p => (p && !p.avatar && avatarOf(p)) ? Object.assign({}, p, { avatar: avatarOf(p) }) : p);
    };
    modes.forEach(mode => {
      const rot = (act.rotations || {})[mode];
      if (!rot || typeof rot !== 'object' || !Array.isArray(rot.players) || !Array.isArray(rot.rounds)) return;
      const lb = computeLeaderboard(playersOf(rot), rot.rounds, rot.scores || {});
      if (lb.scoredMatches === 0) return; // 只统计录了比分的球局
      lb.leaderboard.forEach(p => {
        if (!p || p.plays === 0) return;
        // 有 OpenID 按 OpenID 聚合（改名也累计同一个人）；无则按名字
        const key = p.openid || 'n_' + (p.name || '');
        let t = map[key];
        if (!t) {
          t = { name: p.name || '未知球员', openid: p.openid || '', avatar: p.avatar || '', plays: 0, wins: 0, losses: 0, setWon: 0, setLost: 0, winRate: 0 };
          map[key] = t;
          order.push(t);
        }
        t.plays += p.plays;
        t.wins += p.wins;
        t.losses += p.losses;
        t.setWon += p.setWon;
        t.setLost += p.setLost;
      });
    });
  });

  // 同名归并：同一球员部分球局带 OpenID、部分不带（组织者手动添加）时会被拆成两条，
  // 按名字合并为一条（保留 OpenID 记录，合并战绩）。
  // 注意：两个都带不同 OpenID 的同名者视为不同人，不合并。
  const byName = {};
  const result = [];
  order.forEach(p => {
    const nameKey = p.name || '';
    const prev = byName[nameKey];
    if (prev) {
      if (prev.openid && p.openid && prev.openid !== p.openid) {
        // 两个不同 OpenID 的同名 → 不同人，分开保留
        result.push(p);
      } else {
        // 同名字（至少一方无 OpenID，或 OpenID 相同）→ 视为同一人，合并战绩
        prev.plays += p.plays;
        prev.wins += p.wins;
        prev.losses += p.losses;
        prev.setWon += p.setWon;
        prev.setLost += p.setLost;
        if (!prev.openid && p.openid) prev.openid = p.openid;
        if (!prev.avatar && p.avatar) prev.avatar = p.avatar;
      }
    } else {
      byName[nameKey] = p;
      result.push(p);
    }
  });

  result.forEach(p => {
    p.winRate = p.plays ? p.wins / p.plays : 0;
  });

  // 排序：胜场 > 胜率 > 姓名
  result.sort((a, b) => (
    b.wins - a.wins ||
    b.winRate - a.winRate ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ));

  let rank = 0;
  let prevKey = null;
  result.forEach((p, i) => {
    const key = p.wins + '|' + p.winRate.toFixed(6);
    if (key !== prevKey) rank = i + 1;
    p.rank = rank;
    prevKey = key;
  });

  return result;
}

module.exports = { computeLeaderboard, computeTotal, matchKey };
