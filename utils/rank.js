/**
 * rank.js —— ELO 段位引擎（纯函数，前端与云函数共用）
 *
 * 设计：
 * - 初始 ELO 1000；前 5 场为定级赛 K=48，定级后 K=24，球王(2100+)以上 K=16
 * - 单打/双打/混双分项 ELO 独立；双打队伍 ELO 取两人均值，个人按个人 ELO 与队伍预期结算
 * - 综合 ELO = 0.4 单打 + 0.3 双打 + 0.3 混双（未打项权重归一化），映射段位/星级
 * - 段位：青羽→白羽→金羽→翡翠→钻石→星耀→最强球王→传奇球王
 */
var cf = require('./confirm');
var score = require('./score');

var MODES = ['singles', 'doubles', 'mixed'];
var MODE_WEIGHT = { singles: 0.4, doubles: 0.3, mixed: 0.3 };

var INITIAL_ELO = 1000;
var PLACEMENT_MATCHES = 5;
var K_PLACEMENT = 48;
var K_NORMAL = 24;
var K_MASTER = 16;
var MASTER_ELO = 2100;
var KING_STAR_SPAN = 10; // 球王以上每 10 分一星

/**
 * 段位定义。
 * subdiv：小段数；per：每小段星数；min：进入该段位的综合 ELO。
 */
var TIERS = [
  { key: 'qingyu', name: '青羽', min: 900, subdiv: 3, per: 3 },
  { key: 'baiyu', name: '白羽', min: 1050, subdiv: 3, per: 3 },
  { key: 'jinyu', name: '金羽', min: 1200, subdiv: 4, per: 4 },
  { key: 'feicui', name: '翡翠', min: 1400, subdiv: 4, per: 4 },
  { key: 'zuanshi', name: '钻石', min: 1600, subdiv: 5, per: 5 },
  { key: 'xingyao', name: '星耀', min: 1850, subdiv: 5, per: 5 },
  { key: 'qiuwang', name: '最强球王', min: 2100, subdiv: 0, per: 0 },
  { key: 'chuanqi', name: '传奇球王', min: 3100, subdiv: 0, per: 0 }
];

/** 球王星级称号 */
var KING_TITLES = [
  { min: 100, name: '传奇球王' },
  { min: 50, name: '荣耀球王' },
  { min: 40, name: '绝世球王' },
  { min: 30, name: '非凡球王' },
  { min: 20, name: '无双球王' },
  { min: 10, name: '至圣球王' },
  { min: 0, name: '新锐球王' }
];

/* ---------------- ELO 基础 ---------------- */

/** A 对 B 的预期胜率（0~1） */
function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** 依据当前 ELO 与已结算场次数取 K 值 */
function kFor(elo, settledCount) {
  if ((settledCount || 0) < PLACEMENT_MATCHES) return K_PLACEMENT;
  if (elo >= MASTER_ELO) return K_MASTER;
  return K_NORMAL;
}

/** 单人一场的 ELO 变化量（未取整） */
function eloDelta(myElo, oppElo, won, settledCount) {
  var e = expected(myElo, oppElo);
  return kFor(myElo, settledCount) * ((won ? 1 : 0) - e);
}

function avg(arr) {
  var s = 0;
  arr.forEach(function (v) { s += v; });
  return arr.length ? s / arr.length : INITIAL_ELO;
}

/**
 * 结算一场比赛（单打/双打通用）。
 * @param {Array<{openid:string,elo:number,count:number}>} teamA 队员；无 openid 表示手动球员（不回写）
 * @param {Array} teamB
 * @param {boolean} aWin A 队是否获胜
 * @returns {Array<{openid:string,elo:number,delta:number}>} 仅含可回写（有 openid）队员的结算结果
 */
function settleMatch(teamA, teamB, aWin) {
  var eloA = avg(teamA.map(function (p) { return p.elo; }));
  var eloB = avg(teamB.map(function (p) { return p.elo; }));
  var out = [];

  function pushMembers(team, teamElo, oppElo, won) {
    team.forEach(function (p) {
      var e = expected(teamElo, oppElo);
      var k = kFor(p.elo, p.count);
      var d = k * ((won ? 1 : 0) - e);
      if (p.openid) {
        out.push({ openid: p.openid, elo: Math.round(p.elo + d), delta: Math.round(d) });
      }
    });
  }
  pushMembers(teamA, eloA, eloB, !!aWin);
  pushMembers(teamB, eloB, eloA, !aWin);
  return out;
}

/* ---------------- 综合 ELO 与段位 ---------------- */

/** 综合 ELO：按已打项权重归一化 */
function combinedElo(elo, counts) {
  var wsum = 0;
  var vsum = 0;
  MODES.forEach(function (m) {
    if ((counts[m] || 0) > 0) {
      wsum += MODE_WEIGHT[m];
      vsum += MODE_WEIGHT[m] * elo[m];
    }
  });
  return wsum ? Math.round(vsum / wsum) : INITIAL_ELO;
}

/** 综合 ELO 所在段位 */
function tierOf(elo) {
  var hit = TIERS[0];
  for (var i = 0; i < TIERS.length; i++) {
    if (elo >= TIERS[i].min) hit = TIERS[i];
  }
  return hit;
}

/** 球王星级对应的称号 */
function kingTitleOf(starCount) {
  for (var i = 0; i < KING_TITLES.length; i++) {
    if (starCount >= KING_TITLES[i].min) return KING_TITLES[i].name;
  }
  return KING_TITLES[KING_TITLES.length - 1].name;
}

/**
 * 段位与星级进度。
 * @returns {{tier:object, placed:boolean, starText:string, subText:string, kingStars:number, kingTitle:string}}
 */
function starsOf(elo) {
  var tier = tierOf(elo);

  // 球王及以上：按星计
  if (tier.subdiv === 0) {
    var stars = Math.max(0, Math.floor((elo - MASTER_ELO) / KING_STAR_SPAN));
    return {
      tier: tier,
      kingStars: stars,
      kingTitle: kingTitleOf(stars),
      starText: stars + ' 星',
      subText: kingTitleOf(stars)
    };
  }

  var idx = TIERS.indexOf(tier);
  var next = TIERS[idx + 1];
  var span = next.min - tier.min;
  var totalSlots = tier.subdiv * tier.per;
  var got = Math.min(totalSlots, Math.floor((elo - tier.min) / span * totalSlots));
  var subPassed = Math.floor(got / tier.per);                 // 已通过的小段数
  var starInSub = got % tier.per;                             // 当前小段已获星
  var curSub = Math.min(tier.subdiv, subPassed + 1);          // 当前小段（1 起）

  return {
    tier: tier,
    got: got,
    totalSlots: totalSlots,
    curSub: curSub,
    starInSub: starInSub,
    per: tier.per,
    starText: starInSub + '/' + tier.per + ' 星',
    subText: tier.name + ' 第' + curSub + '段'
  };
}

/* ---------------- 档案与历史回溯 ---------------- */

/** 中羽在线等级 → ELO 估算（用于无 openid 球员的队伍 ELO） */
function eloFromLevel(level) {
  var map = {
    zy1: 900, zy2: 975, zy3: 1075, zy4: 1200,
    zy5: 1350, zy6: 1550, zy7: 1750, zy8: 1950, zy9: 2200
  };
  return map[level] || INITIAL_ELO;
}

/** 新建一份空档案 */
function freshProfile(openid) {
  return {
    openid: openid || '',
    name: '',
    avatar: '',
    elo: { singles: INITIAL_ELO, doubles: INITIAL_ELO, mixed: INITIAL_ELO },
    counts: { singles: 0, doubles: 0, mixed: 0 },
    combined: INITIAL_ELO,
    tier: TIERS[0].key,
    tierName: TIERS[0].name,
    played: false,
    placed: false,
    updatedAt: 0
  };
}

/** 计算档案的综合 ELO / 段位 / 定级标记 */
function finalize(profile, now) {
  profile.combined = combinedElo(profile.elo, profile.counts);
  var t = tierOf(profile.combined);
  profile.tier = t.key;
  profile.tierName = t.name;
  var total = profile.counts.singles + profile.counts.doubles + profile.counts.mixed;
  profile.played = total > 0;
  // 至少一个分项完成定级赛（5 场）才进正式榜
  profile.placed = MODES.some(function (m) { return profile.counts[m] >= PLACEMENT_MATCHES; });
  profile.updatedAt = now || profile.updatedAt || 0;
  return profile;
}

/**
 * 从球局列表按时间顺序重放所有「已确认」比赛，重建每个人的档案。
 * @param {Array} activities 球局文档（内部会按 createdAt 升序）
 * @returns {Object} { openid: profile }
 */
function replay(activities, now) {
  var list = (activities || []).slice().sort(function (a, b) {
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  var profiles = {};
  function getP(openid) {
    if (!profiles[openid]) profiles[openid] = freshProfile(openid);
    return profiles[openid];
  }

  list.forEach(function (act) {
    MODES.forEach(function (mode) {
      var rot = act.rotations && act.rotations[mode];
      if (!rot || !rot.rounds || !rot.players) return;

      rot.rounds.forEach(function (r) {
        (r.matches || []).forEach(function (m) {
          var key = score.matchKey(r.no, m.court);
          var raw = (rot.scores || {})[key];
          var rec = cf.normalizeRecord(raw);
          if (rec.status !== cf.STATUS.CONFIRMED) return;
          if (rec.sA === rec.sB) return; // 平/未记不结算

          function toMember(idx) {
            var p = rot.players[idx] || {};
            if (p.openid) {
              var pr = getP(p.openid);
              return { openid: p.openid, elo: pr.elo[mode], count: pr.counts[mode] };
            }
            return { openid: '', elo: eloFromLevel(p.level), count: PLACEMENT_MATCHES };
          }

          var teamA = m.teamA.map(toMember);
          var teamB = m.teamB.map(toMember);
          var results = settleMatch(teamA, teamB, rec.sA > rec.sB);

          results.forEach(function (rr) {
            var pr = getP(rr.openid);
            pr.elo[mode] = rr.elo;
            pr.counts[mode] += 1;
          });
        });
      });
    });
  });

  Object.keys(profiles).forEach(function (oid) {
    finalize(profiles[oid], now);
  });
  return profiles;
}

/**
 * 增量结算单场（供云函数在比赛确认后调用）。
 * @param {string} mode singles/doubles/mixed
 * @param {Object} rotation 某分项的 rotation 快照
 * @param {Object} match 比赛 {court,teamA,teamB}
 * @param {number} roundNo
 * @param {Object} existing { openid: profile } 现有档案（会被就地修改并返回）
 * @returns {Array<{openid,delta,elo}>} 本次有 openid 队员的变化
 */
function settleOne(mode, rotation, match, roundNo, existing, now) {
  existing = existing || {};
  function getP(openid) {
    if (!existing[openid]) existing[openid] = freshProfile(openid);
    return existing[openid];
  }

  function toMember(idx) {
    var p = rotation.players[idx] || {};
    if (p.openid) {
      var pr = getP(p.openid);
      return { openid: p.openid, elo: pr.elo[mode], count: pr.counts[mode] };
    }
    return { openid: '', elo: eloFromLevel(p.level), count: PLACEMENT_MATCHES };
  }

  var rec = cf.normalizeRecord((rotation.scores || {})[score.matchKey(roundNo, match.court)]);
  var teamA = match.teamA.map(toMember);
  var teamB = match.teamB.map(toMember);
  var results = settleMatch(teamA, teamB, rec.sA > rec.sB);

  results.forEach(function (rr) {
    var pr = getP(rr.openid);
    pr.elo[mode] = rr.elo;
    pr.counts[mode] += 1;
    finalize(pr, now);
  });
  return results;
}

module.exports = {
  MODES: MODES,
  INITIAL_ELO: INITIAL_ELO,
  PLACEMENT_MATCHES: PLACEMENT_MATCHES,
  MASTER_ELO: MASTER_ELO,
  TIERS: TIERS,
  expected: expected,
  kFor: kFor,
  eloDelta: eloDelta,
  settleMatch: settleMatch,
  combinedElo: combinedElo,
  tierOf: tierOf,
  kingTitleOf: kingTitleOf,
  starsOf: starsOf,
  eloFromLevel: eloFromLevel,
  freshProfile: freshProfile,
  finalize: finalize,
  replay: replay,
  settleOne: settleOne
};
