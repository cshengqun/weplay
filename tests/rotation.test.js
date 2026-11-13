/**
 * 轮转算法验证（node 运行）
 * 验证维度：每轮每人至多上场一次、搭档/对阵不重复、覆盖度、公平轮休、人数不足报错、自定义轮数
 */
const rot = require('../utils/rotation');

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

function makePlayers(n, genders) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: 'p' + i, name: '球员' + (i + 1), gender: genders ? genders[i] || '' : '' });
  }
  return arr;
}

// 校验轮转表通用约束
function validateRounds(name, players, res, expectMatches) {
  const n = players.length;
  res.rounds.forEach(r => {
    const seen = new Set();
    r.matches.forEach(m => {
      [...m.teamA, ...m.teamB].forEach(i => {
        if (i < 0 || i >= n) {
          assert(name + ' 越界下标', false, r);
          return;
        }
        if (seen.has(i)) assert(name + ' 第' + r.no + '轮重复上场 ' + i, false, r);
        seen.add(i);
      });
    });
    r.waiting.forEach(i => {
      if (seen.has(i)) assert(name + ' 第' + r.no + '轮轮空与上场重叠', false, r);
    });
    assert(name + ' 第' + r.no + '轮空场', r.matches.length >= 1, r);
  });
  // 全场无重复对阵（teamA vs teamB 视为无序对集）
  const seenMatches = new Set();
  res.rounds.forEach(r => {
    r.matches.forEach(m => {
      const key = JSON.stringify([[...m.teamA].sort(), [...m.teamB].sort()]);
      if (seenMatches.has(key)) assert(name + ' 对阵重复', false, { key });
      seenMatches.add(key);
    });
  });
  const total = res.rounds.reduce((s, r) => s + r.matches.length, 0);
  assert(name + ' 总场次=' + expectMatches, total === expectMatches, total);
  // stats 与场次一致
  const plays = res.stats.perPlayer.map(p => p.plays);
  const calc = new Array(n).fill(0);
  res.rounds.forEach(r => r.matches.forEach(m => {
    [...m.teamA, ...m.teamB].forEach(i => calc[i]++);
  }));
  assert(name + ' 统计一致', JSON.stringify(plays) === JSON.stringify(calc));
}

// 搭档组合不重复（双打/混双，只统计同队内的搭档对）
function validateNoRepeatPartners(name, players, res, expectCount) {
  const pairs = new Set();
  res.rounds.forEach(r => r.matches.forEach(m => {
    [m.teamA, m.teamB].forEach(team => {
      const a = team[0];
      const b = team[1];
      if (a < b) pairs.add(a + '-' + b);
      else pairs.add(b + '-' + a);
    });
  }));
  assert(name + ' 搭档组合不重复且共 ' + expectCount + ' 种', pairs.size === expectCount, pairs.size);
}

console.log('\n【单打】8 人 2 场地（自动，覆盖 C(8,2)=28 场 → 14 轮 × 2 场）');
{
  const players = makePlayers(8);
  const res = rot.generateSingles(players, 2, 0);
  assert('ok', res.ok);
  assert('轮数=14', res.totalRounds === 14, res.totalRounds);
  assert('每人恰好 7 场', res.stats.perPlayer.every(p => p.plays === 7), res.stats.perPlayer.map(p => p.plays));
  validateRounds('单打8人', players, res, 28);
}

console.log('\n【单打】7 人 2 场地（奇数，每人恰好轮空 1 次）');
{
  const players = makePlayers(7);
  const res = rot.generateSingles(players, 2, 0);
  assert('ok', res.ok);
  assert('轮数=11（10×2+1）', res.totalRounds === 11, res.totalRounds);
  validateRounds('单打7人', players, res, 21);
  assert('每人恰好 6 场', res.stats.perPlayer.every(p => p.plays === 6), res.stats.perPlayer.map(p => p.plays));
}

console.log('\n【双打】8 人 2 场地（自动，搭档全轮换 28 对 → 7 轮 × 2 场）');
{
  const players = makePlayers(8);
  const res = rot.generateDoubles(players, 2, 0);
  assert('ok', res.ok);
  assert('轮数=7', res.totalRounds === 7, res.totalRounds);
  assert('每人每轮 1 场、无轮空', res.rounds.every(r => r.matches.length === 2 && r.waiting.length === 0));
  validateRounds('双打8人', players, res, 14);
  validateNoRepeatPartners('双打8人', players, res, 28);
}

console.log('\n【双打】10 人 2 场地（自动，45 对搭档，每轮 8 人上场 2 人轮休）');
{
  const players = makePlayers(10);
  const res = rot.generateDoubles(players, 2, 0);
  assert('ok', res.ok);
  assert('轮数=9', res.totalRounds === 9, res.totalRounds);
  assert('每轮 2 场、2 人轮休', res.rounds.every(r => r.matches.length === 2 && r.waiting.length === 2));
  validateRounds('双打10人', players, res, 18);
  validateNoRepeatPartners('双打10人', players, res, 36);
  const plays = res.stats.perPlayer.map(p => p.plays);
  const max = Math.max(...plays);
  const min = Math.min(...plays);
  assert('轮休均衡（上场次数差≤1）', max - min <= 1, { max, min, plays });
}

console.log('\n【双打】6 人 1 场地（奇数队轮休轮换，搭档不重复）');
{
  const players = makePlayers(6);
  const res = rot.generateDoubles(players, 1, 0);
  assert('ok', res.ok);
  assert('轮数=5', res.totalRounds === 5, res.totalRounds);
  assert('每轮 1 场、2 人轮休', res.rounds.every(r => r.matches.length === 1 && r.waiting.length === 2));
  validateRounds('双打6人', players, res, 5);
  validateNoRepeatPartners('双打6人', players, res, 10);
  const plays = res.stats.perPlayer.map(p => p.plays);
  const max = Math.max(...plays);
  const min = Math.min(...plays);
  assert('轮休较均衡（上场次数差≤2）', max - min <= 2, { max, min, plays });
}

console.log('\n【双打】自定义轮数：8 人 2 场地只打 3 轮');
{
  const players = makePlayers(8);
  const res = rot.generateDoubles(players, 2, 3);
  assert('ok', res.ok);
  assert('轮数=3', res.totalRounds === 3, res.totalRounds);
  assert('每轮 2 场', res.rounds.every(r => r.matches.length === 2));
  validateRounds('双打自定义', players, res, 6);
  validateNoRepeatPartners('双打自定义', players, res, 12);
}

console.log('\n【混双】4 男 4 女 2 场地（16 对搭档 → 4 轮 × 2 场）');
{
  const genders = ['male', 'male', 'male', 'male', 'female', 'female', 'female', 'female'];
  const players = makePlayers(8, genders);
  const res = rot.generateMixed(players, 2, 0);
  assert('ok', res.ok);
  assert('轮数=4', res.totalRounds === 4, res.totalRounds);
  res.rounds.forEach(r => {
    r.matches.forEach(m => {
      const gA = m.teamA.map(i => players[i].gender);
      const gB = m.teamB.map(i => players[i].gender);
      assert('混双每队一男一女', gA.includes('male') && gA.includes('female') && gB.includes('male') && gB.includes('female'), { gA, gB });
    });
  });
  validateRounds('混双8人', players, res, 8);
  validateNoRepeatPartners('混双8人', players, res, 16);
}

console.log('\n【混双】3 男 4 女（实际可用 1 片场地 → 4 轮 × 1 场，12 对搭档全覆盖）');
{
  const genders = ['male', 'male', 'male', 'female', 'female', 'female', 'female'];
  const players = makePlayers(7, genders);
  const res = rot.generateMixed(players, 2, 0);
  assert('ok', res.ok);
  assert('可用场地=1', res.courts === 1, res.courts);
  assert('轮数=4', res.totalRounds === 4, res.totalRounds);
  validateRounds('混双7人', players, res, 4);
  validateNoRepeatPartners('混双7人', players, res, 8); // 1 片场地限制下覆盖 8/12 对
  const plays = res.stats.perPlayer.map(p => p.plays);
  const max = Math.max(...plays);
  const min = Math.min(...plays);
  assert('轮休均衡（上场次数差≤1）', max - min <= 1, { max, min, plays });
}

console.log('\n【边界】');
{
  assert('单打 1 人报错', !!rot.generateSingles(makePlayers(1), 1, 0).error);
  assert('双打 3 人报错', !!rot.generateDoubles(makePlayers(3), 1, 0).error);
  const m4 = makePlayers(4, ['male', 'male', 'male', 'male']);
  assert('混双只有男报错', !!rot.generateMixed(m4, 1, 0).error);
  const withUnknown = makePlayers(6, ['male', 'male', 'male', 'female', 'female', '']);
  const res = rot.generateMixed(withUnknown, 1, 0);
  assert('混双排除未设性别者', res.excluded && res.excluded.length === 1, res.excluded);
  assert('混双排除后仍可生成', !!res.ok);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
