/**
 * ELO 段位引擎验证（node 运行）
 * 维度：预期胜率、K 值、单打/双打结算、爆冷与抱大腿、综合 ELO、段位星级、历史回溯/定级
 */
const rank = require('../utils/rank');

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : ''));
  }
}
function approx(a, b, tol) {
  return Math.abs(a - b) <= (tol || 0.5);
}

console.log('【预期胜率】');
{
  assert('同 ELO → 0.5', approx(rank.expected(1000, 1000), 0.5, 0.001));
  assert('高 400 分 → ~0.909', approx(rank.expected(1400, 1000), 0.909, 0.001));
  assert('低 400 分 → ~0.091', approx(rank.expected(1000, 1400), 0.091, 0.001));
}

console.log('【K 值】');
{
  assert('定级赛 K=48', rank.kFor(1000, 3) === 48);
  assert('定级后 K=24', rank.kFor(1200, 5) === 24);
  assert('球王以上 K=16', rank.kFor(2100, 50) === 16);
}

console.log('【单打结算】');
{
  // 均势，甲胜：+12 / -12
  let r = rank.settleMatch(
    [{ openid: 'a', elo: 1000, count: 5 }],
    [{ openid: 'b', elo: 1000, count: 5 }],
    true
  );
  let a = r.find(x => x.openid === 'a');
  let b = r.find(x => x.openid === 'b');
  assert('均势胜者 +12 → 1012', a.elo === 1012, a);
  assert('均势负者 -12 → 988', b.elo === 988, b);

  // 强胜弱：赢家收益小
  r = rank.settleMatch(
    [{ openid: 'a', elo: 1400, count: 5 }],
    [{ openid: 'b', elo: 1000, count: 5 }],
    true
  );
  a = r.find(x => x.openid === 'a');
  assert('碾压局胜者仅 +2 → 1402', a.elo === 1402, a);

  // 爆冷：弱胜强，收益大
  r = rank.settleMatch(
    [{ openid: 'a', elo: 1400, count: 5 }],
    [{ openid: 'b', elo: 1000, count: 5 }],
    false
  );
  b = r.find(x => x.openid === 'b');
  a = r.find(x => x.openid === 'a');
  assert('爆冷弱者 +22 → 1022', b.elo === 1022, b);
  assert('爆冷强者 -22 → 1378', a.elo === 1378, a);
}

console.log('【双打结算：抱大腿】');
{
  // 甲(1800)带 弱(1000)，队伍均值 1400，对阵两个 1000（均值1000），甲队胜
  const r = rank.settleMatch(
    [{ openid: 'a', elo: 1800, count: 5 }, { openid: 'c', elo: 1000, count: 5 }],
    [{ openid: 'b', elo: 1000, count: 5 }, { openid: 'd', elo: 1000, count: 5 }],
    true
  );
  const carried = r.find(x => x.openid === 'c');
  assert('抱大腿赢，弱者仅 +2 → 1002', carried.elo === 1002, carried);

  // 手动球员（无 openid）不回写
  const r2 = rank.settleMatch(
    [{ openid: '', elo: 1000, count: 5 }, { openid: 'a', elo: 1000, count: 5 }],
    [{ openid: 'b', elo: 1000, count: 5 }, { openid: 'd', elo: 1000, count: 5 }],
    true
  );
  assert('无 openid 队员不产生回写', r2.length === 3);
}

console.log('【综合 ELO】');
{
  assert('三项都打：0.4/0.3/0.3', rank.combinedElo(
    { singles: 1200, doubles: 1000, mixed: 1000 },
    { singles: 5, doubles: 5, mixed: 5 }
  ) === 1080);
  assert('只打单打：取单打值', rank.combinedElo(
    { singles: 1200, doubles: 1000, mixed: 1000 },
    { singles: 5, doubles: 0, mixed: 0 }
  ) === 1200);
  assert('都没打：1000', rank.combinedElo(
    { singles: 1000, doubles: 1000, mixed: 1000 },
    { singles: 0, doubles: 0, mixed: 0 }
  ) === 1000);
}

console.log('【段位与星级】');
{
  assert('1000 → 青羽', rank.tierOf(1000).key === 'qingyu');
  assert('1200 → 金羽', rank.tierOf(1200).key === 'jinyu');
  assert('1600 → 钻石', rank.tierOf(1600).key === 'zuanshi');
  assert('2100 → 最强球王', rank.tierOf(2100).key === 'qiuwang');
  assert('3100 → 传奇球王', rank.tierOf(3100).key === 'chuanqi');

  // 金羽 1300：16 星槽，进度 8，已过 2 小段 → 第3段 0/4
  const s = rank.starsOf(1300);
  assert('金羽1300 在第3段 0/4', s.curSub === 3 && s.starInSub === 0, s);

  // 球王星与称号
  assert('球王 2100 0 星 → 新锐球王', rank.starsOf(2100).kingTitle === '新锐球王');
  assert('球王 2200 10 星 → 至圣球王', rank.starsOf(2200).kingTitle === '至圣球王');
  assert('球王 2400 30 星 → 非凡球王', rank.starsOf(2400).kingTitle === '非凡球王');
  assert('球王 3100 100 星 → 传奇球王', rank.starsOf(3100).kingTitle === '传奇球王');

  assert('中羽等级估算 zy5≈1350', rank.eloFromLevel('zy5') === 1350);
  assert('未知等级 → 1000', rank.eloFromLevel('') === 1000);
}

console.log('【历史回溯与定级】');
{
  // 构造甲、乙连续打 n 场、甲全胜的单打活动（老数据无 status）
  function singlesAct(n, createdAt) {
    const players = [{ name: '甲', openid: 'oa' }, { name: '乙', openid: 'ob' }];
    const rounds = [];
    const scores = {};
    for (let i = 1; i <= n; i++) {
      rounds.push({ no: i, matches: [{ court: 1, teamA: [0], teamB: [1] }] });
      scores[i + '-1'] = { sA: 21, sB: 15 };
    }
    return {
      _id: 'act' + createdAt,
      createdAt,
      rotations: { singles: { players, rounds, scores }, doubles: null, mixed: null }
    };
  }

  // 3 场：定级中，不上榜
  let profiles = rank.replay([singlesAct(3, 1)]);
  assert('3 场 counts=3', profiles.oa.counts.singles === 3);
  assert('3 场 played 但未 placed', profiles.oa.played && !profiles.oa.placed);

  // 5 场：完成定级，上榜；甲全胜 ELO 高于乙
  profiles = rank.replay([singlesAct(5, 1)]);
  assert('5 场 placed', profiles.oa.placed && profiles.ob.placed);
  assert('全胜者 ELO 高于全负者', profiles.oa.combined > profiles.ob.combined);
  assert('全胜者进入更高 ELO', profiles.oa.combined > 1000 && profiles.ob.combined < 1000);

  // 多活动按时间合并（同一 openid 累计）
  profiles = rank.replay([singlesAct(3, 1), singlesAct(2, 2)]);
  assert('跨活动累计 5 场上榜', profiles.oa.counts.singles === 5 && profiles.oa.placed, profiles.oa);
}

console.log('【增量结算 settleOne】');
{
  const players = [{ name: '甲', openid: 'oa' }, { name: '乙', openid: 'ob' }];
  const rotation = {
    players,
    rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }],
    scores: { '1-1': { sA: 21, sB: 15 } }
  };
  const match = rotation.rounds[0].matches[0];
  const existing = { oa: rank.freshProfile('oa'), ob: rank.freshProfile('ob') };
  const changes = rank.settleOne('singles', rotation, match, 1, existing, Date.now());
  assert('增量结算两场员', changes.length === 2);
  assert('甲 counts=1', existing.oa.counts.singles === 1);
  assert('甲首胜 ELO 上升（定级 K48）', existing.oa.elo.singles > 1000, existing.oa);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
