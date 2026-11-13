/**
 * 战绩榜（胜场 / 胜率）算法验证（node 运行）
 */
const sc = require('../utils/score');

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

// 单打 4 人 2 场地 3 轮（手动构造轮次）
const players = [
  { name: '甲' }, { name: '乙' }, { name: '丙' }, { name: '丁' }
];
const rounds = [
  { no: 1, matches: [
    { court: 1, teamA: [0], teamB: [1] },  // 甲 vs 乙
    { court: 2, teamA: [2], teamB: [3] }   // 丙 vs 丁
  ]},
  { no: 2, matches: [
    { court: 1, teamA: [0], teamB: [2] },  // 甲 vs 丙
    { court: 2, teamA: [1], teamB: [3] }   // 乙 vs 丁
  ]},
  { no: 3, matches: [
    { court: 1, teamA: [0], teamB: [3] },  // 甲 vs 丁
    { court: 2, teamA: [1], teamB: [2] }   // 乙 vs 丙
  ]}
];

console.log('\n【单打战绩】甲 3 胜、乙 2 胜 1 负、丙 1 胜 2 负、丁 3 负');
{
  const scores = {
    '1-1': { sA: 21, sB: 18 }, // 甲胜
    '1-2': { sA: 21, sB: 19 }, // 丙胜
    '2-1': { sA: 21, sB: 12 }, // 甲胜
    '2-2': { sA: 21, sB: 15 }, // 乙胜
    '3-1': { sA: 21, sB: 20 }, // 甲胜
    '3-2': { sA: 21, sB: 17 }  // 乙胜
  };
  const res = sc.computeLeaderboard(players, rounds, scores);
  assert('6 场全部已记', res.scoredMatches === 6 && res.totalMatches === 6, { total: res.totalMatches, scored: res.scoredMatches });
  const byName = {};
  res.leaderboard.forEach(p => (byName[p.name] = p));
  assert('甲 3胜3场 100%', byName['甲'].wins === 3 && byName['甲'].plays === 3 && byName['甲'].winRate === 1, byName['甲']);
  assert('乙 2胜3场 66.7%', byName['乙'].wins === 2 && byName['乙'].losses === 1 && Math.abs(byName['乙'].winRate - 2 / 3) < 1e-9, byName['乙']);
  assert('丙 1胜3场', byName['丙'].wins === 1 && byName['丙'].losses === 2, byName['丙']);
  assert('丁 0胜3场', byName['丁'].wins === 0 && byName['丁'].losses === 3, byName['丁']);
  assert('排名顺序 甲乙丙丁', res.leaderboard.map(p => p.name).join('') === '甲乙丙丁', res.leaderboard.map(p => p.name));
  assert('名次 1/2/3/4', res.leaderboard.map(p => p.rank).join(',') === '1,2,3,4', res.leaderboard.map(p => p.rank));
  assert('无积分字段', !('points' in byName['甲']), byName['甲']);
}

console.log('\n【胜场相同比胜率】乙 1 胜 1 负(50%) vs 丙 1 胜 2 负(33%) → 乙靠前');
{
  const scores = {
    '1-1': { sA: 21, sB: 18 }, // 甲胜
    '2-1': { sA: 21, sB: 18 }, // 甲胜
    '2-2': { sA: 21, sB: 10 }, // 乙胜
    '3-1': { sA: 21, sB: 12 }, // 甲胜
    '3-2': { sA: 21, sB: 19 }, // 乙胜 → 乙 2胜1负
  };
  const res = sc.computeLeaderboard(players, rounds, scores);
  assert('乙(2胜) 第一、甲(3胜) 0 场被忽略? 甲3胜更前', res.leaderboard[0].name === '甲', res.leaderboard.map(p => p.name));
}

console.log('\n【双打战绩】按人累计；未记分场次不计');
{
  const dPlayers = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
  const dRounds = [
    { no: 1, matches: [{ court: 1, teamA: [0, 1], teamB: [2, 3] }] },
    { no: 2, matches: [{ court: 1, teamA: [0, 2], teamB: [1, 3] }] }
  ];
  const scores = {
    '1-1': { sA: 21, sB: 15 } // A+B 胜；2-1 未记录
  };
  const res = sc.computeLeaderboard(dPlayers, dRounds, scores);
  const byName = {};
  res.leaderboard.forEach(p => (byName[p.name] = p));
  assert('A、B 各 1 胜 100%', byName['A'].wins === 1 && byName['B'].wins === 1 && byName['A'].winRate === 1, { A: byName['A'], B: byName['B'] });
  assert('C、D 各 1 负 0%', byName['C'].wins === 0 && byName['D'].wins === 0 && byName['C'].losses === 1, { C: byName['C'], D: byName['D'] });
  assert('未记场次不计入', byName['A'].plays === 1 && res.totalMatches === 2 && res.scoredMatches === 1, { A: byName['A'], total: res.totalMatches, scored: res.scoredMatches });
  assert('A、B 并列第一', byName['A'].rank === 1 && byName['B'].rank === 1, res.leaderboard.map(p => ({ n: p.name, r: p.rank })));
}

console.log('\n【边界】无比分时不崩；0:0 / 同分视为未记');
{
  const res = sc.computeLeaderboard(players, rounds, {});
  assert('无人上场', res.leaderboard.every(p => p.plays === 0 && p.wins === 0));
  assert('scoredMatches=0', res.scoredMatches === 0);
  const res2 = sc.computeLeaderboard(players, rounds, { '1-1': { sA: 0, sB: 0 }, '1-2': { sA: 1, sB: 1 } });
  assert('0:0 与 1:1 均不计', res2.scoredMatches === 0, res2.scoredMatches);
}

console.log('\n【确定性用例】固定轮次 + 比分，验证战绩归属');
{
  const fPlayers = [{ name: '阿强' }, { name: '小刚' }, { name: '大鹏' }, { name: '老周' }];
  const fRounds = [
    { no: 1, matches: [{ court: 1, teamA: [2, 3], teamB: [1, 0] }] },
    { no: 2, matches: [{ court: 1, teamA: [2, 1], teamB: [0, 3] }] },
    { no: 3, matches: [{ court: 1, teamA: [2, 0], teamB: [3, 1] }] }
  ];
  const fScores = {
    '1-1': { sA: 21, sB: 18 }, // 大鹏+老周 胜
    '2-1': { sA: 19, sB: 21 }  // 阿强+老周 胜
  };
  const res = sc.computeLeaderboard(fPlayers, fRounds, fScores);
  const m = {};
  res.leaderboard.forEach(p => (m[p.name] = p));
  assert('老周 2胜（两场均胜）', m['老周'].wins === 2 && m['老周'].plays === 2, m['老周']);
  assert('大鹏 1胜', m['大鹏'].wins === 1 && m['大鹏'].losses === 1, m['大鹏']);
  assert('阿强 1胜', m['阿强'].wins === 1 && m['阿强'].losses === 1, m['阿强']);
  assert('小刚 0胜', m['小刚'].wins === 0 && m['小刚'].losses === 2, m['小刚']);
  assert('老周第一、大鹏与阿强胜场胜率相同并列第二', res.leaderboard[0].name === '老周' && m['大鹏'].rank === 2 && m['阿强'].rank === 2 && m['小刚'].rank === 4,
    res.leaderboard.map(p => p.name + ':' + p.rank));
}

console.log('\n【总榜】跨球局按名字聚合胜场与胜率');
{
  // 球局 1：单打 老周 1 胜；球局 2：双打 老周 1 胜 1 负 → 总 2 胜 1 负 66.7%
  const activities = [
    {
      name: '球局A',
      rotations: {
        singles: {
          confirmed: true,
          players: [{ name: '老周' }, { name: '大鹏' }],
          rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }],
          scores: { '1-1': { sA: 21, sB: 18 } }
        },
        doubles: null,
        mixed: null
      }
    },
    {
      name: '球局B',
      rotations: {
        singles: null,
        doubles: null,
        mixed: {
          confirmed: true,
          players: [{ name: '老周' }, { name: '阿强' }, { name: '大鹏' }, { name: '小刚' }],
          rounds: [
            { no: 1, matches: [{ court: 1, teamA: [0, 1], teamB: [2, 3] }] },
            { no: 2, matches: [{ court: 1, teamA: [0, 3], teamB: [1, 2] }] }
          ],
          scores: { '1-1': { sA: 21, sB: 15 }, '2-1': { sA: 19, sB: 21 } }
        }
      }
    },
    // 球局 C：没有录比分 → 不进总榜
    {
      name: '球局C',
      rotations: {
        singles: { confirmed: true, players: [{ name: '老周' }, { name: '大鹏' }], rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }], scores: {} }
      }
    }
  ];
  const total = sc.computeTotal(activities);
  const m = {};
  total.forEach(p => (m[p.name] = p));
  assert('老周总 2胜1负 66.7%', m['老周'] && m['老周'].wins === 2 && m['老周'].losses === 1 && Math.abs(m['老周'].winRate - 2 / 3) < 1e-9, m['老周']);
  assert('阿强总 2胜0负 100%（球局B两场全胜）', m['阿强'] && m['阿强'].wins === 2 && m['阿强'].losses === 0 && m['阿强'].winRate === 1, m['阿强']);
  assert('大鹏总 1胜2负（球局A负 + 球局B一胜一负）', m['大鹏'] && m['大鹏'].wins === 1 && m['大鹏'].losses === 2, m['大鹏']);
  assert('小刚总 0胜2负', m['小刚'] && m['小刚'].wins === 0 && m['小刚'].losses === 2, m['小刚']);
  assert('球局C 无比分不计入', m['老周'].plays === 3, m['老周']);
  assert('总榜排序：阿强(2胜100%) > 老周(2胜67%) > 大鹏(1胜) > 小刚', total.map(p => p.name).join('') === '阿强老周大鹏小刚', total.map(p => p.name));
  assert('总榜无积分字段', !('points' in m['老周']), m['老周']);
}

console.log('\n【OpenID 聚合】同人改名合并、同名不同人分开');
{
  // 球局1：openid X 以「小明」报名打 1 胜；球局2：openid X 改昵称「小明明」打 1 负 → 合并为 1胜1负
  // 球局3：openid Y 也叫「小明」打 1 负 → 与 X 分开
  const activities = [
    {
      name: '球局X1',
      rotations: {
        singles: {
          confirmed: true,
          players: [{ name: '小明', openid: 'X' }, { name: '路人甲', openid: 'A' }],
          rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }],
          scores: { '1-1': { sA: 21, sB: 10 } }
        }
      }
    },
    {
      name: '球局X2',
      rotations: {
        singles: {
          confirmed: true,
          players: [{ name: '小明明', openid: 'X' }, { name: '路人乙', openid: 'B' }],
          rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }],
          scores: { '1-1': { sA: 10, sB: 21 } }
        }
      }
    },
    {
      name: '球局Y',
      rotations: {
        singles: {
          confirmed: true,
          players: [{ name: '小明', openid: 'Y' }, { name: '路人丙', openid: 'C' }],
          rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }],
          scores: { '1-1': { sA: 15, sB: 21 } }
        }
      }
    }
  ];
  const total = sc.computeTotal(activities);
  const byName = {};
  total.forEach(p => (byName[p.name] = p));
  // openid X：2 场（改名合并）
  const x = total.find(p => p.openid === 'X');
  assert('同 OpenID 改名合并：2场1胜1负', x && x.plays === 2 && x.wins === 1 && x.losses === 1, x);
  const y = total.find(p => p.openid === 'Y');
  assert('不同 OpenID 同名分开：Y 只 1 场', y && y.plays === 1 && y.losses === 1, y);
  assert('总榜条数 = 5（X、Y、路人甲、路人乙、路人丙）', total.length === 5, total.map(p => p.openid + p.name));
  // 无 openid 的球员按名字聚合（组织者手填场景）
  const acts2 = [
    {
      name: '手填1',
      rotations: {
        singles: { confirmed: true, players: [{ name: '老王', openid: '' }, { name: '老李', openid: '' }], rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }], scores: { '1-1': { sA: 21, sB: 9 } } }
      }
    },
    {
      name: '手填2',
      rotations: {
        singles: { confirmed: true, players: [{ name: '老王', openid: '' }, { name: '老赵', openid: '' }], rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }], scores: { '1-1': { sA: 21, sB: 8 } } }
      }
    }
  ];
  const t2 = sc.computeTotal(acts2);
  const wang = t2.find(p => p.name === '老王');
  assert('无 OpenID 按名字聚合：老王 2 胜', wang && wang.plays === 2 && wang.wins === 2, wang);
}

console.log('\n【防御】异常数据（null 活动/缺字段）不崩溃');
{
  const bad = sc.computeTotal([null, undefined, { name: '空对象' }, { id: 'x', rotations: { singles: '异常' } }]);
  assert('异常活动安全跳过', Array.isArray(bad) && bad.length === 0, bad);
  const mixed = sc.computeTotal([
    null,
    {
      name: '球局',
      rotations: {
        singles: { players: [null, { name: '甲' }], rounds: [{ no: 1, matches: [{ court: 1, teamA: [0], teamB: [1] }] }], scores: { '1-1': { sA: 21, sB: 10 } } }
      }
    }
  ]);
  assert('脏球员兜底不崩溃且出榜', mixed.length >= 1, mixed.map(p => p.name));
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
