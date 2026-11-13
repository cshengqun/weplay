/**
 * 轮转算法核心模块
 * 支持：单打轮转 / 双打轮转 / 混双轮转
 *
 * 算法设计（圆桌轮转法 Circle Method）：
 *  - 单打：将球员排成一圈（奇数时补虚拟球员制造轮空），每轮固定 1 号、其余循环移位，
 *          得到 (n-1) 轮完美配对，覆盖全部 C(n,2) 种对阵，且每人每轮只打一场。
 *  - 双打：同一套完美配对即为"搭档组合"，每人每轮与不同人搭档，搭档覆盖全部 C(n,2) 种；
 *          每轮把搭档组合两两成组为一场比赛，剩余一组按轮次轮转休息，公平轮休。
 *  - 混双：男女分别排圈，按轮次错位配对，覆盖全部 男×女 搭档组合。
 *  - 场地限制：将全部比赛按"每轮最多 C 场"切成实际轮次；
 *    maxRounds 为空 = 自动打完所有组合，否则只取前 N 轮。
 *  - 生成时对球员顺序做一次随机洗牌，让每次生成的对阵都不相同。
 */

// ---------- 基础工具 ----------

/** Fisher-Yates 洗牌（返回新数组） */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * 圆桌轮转：m 必须为偶数（奇数时调用方先补 1 名虚拟球员）
 * 返回 (m-1) 轮，每轮为 m/2 个无序对 [a, b]（0 号固定，其余循环移位）
 */
function circleRoundRobbin(m) {
  const rounds = [];
  const base = [];
  for (let i = 1; i < m; i++) base.push(i);
  for (let r = 0; r < m - 1; r++) {
    const order = [0].concat(base);
    const pairs = [];
    for (let i = 1; i <= m / 2; i++) {
      pairs.push([order[i - 1], order[m - i]]);
    }
    rounds.push(pairs);
    base.push(base.shift());
  }
  return rounds;
}

/**
 * 把比赛队列切成实际轮次（每轮至多 courts 场）
 */
function chunkByCourts(queue, courts, maxRounds) {
  const rounds = [];
  const q = queue.slice();
  while (q.length && (maxRounds === null || rounds.length < maxRounds)) {
    rounds.push(q.splice(0, courts));
  }
  return rounds;
}

/**
 * 计算每轮轮空名单（未上场球员下标，按原顺序）
 */
function computeWaiting(playerCount, matches) {
  const onCourt = new Set();
  matches.forEach(m => {
    m.teamA.forEach(i => onCourt.add(i));
    m.teamB.forEach(i => onCourt.add(i));
  });
  const waiting = [];
  for (let i = 0; i < playerCount; i++) {
    if (!onCourt.has(i)) waiting.push(i);
  }
  return waiting;
}

/** 统计每人上场次数 */
function buildStats(players, rounds) {
  const perPlayer = players.map(p => ({ name: p.name, plays: 0, gender: p.gender || '' }));
  rounds.forEach(r => {
    r.matches.forEach(m => {
      m.teamA.forEach(i => perPlayer[i].plays++);
      m.teamB.forEach(i => perPlayer[i].plays++);
    });
  });
  return { perPlayer };
}

/**
 * 穷举某轮的所有轮休组合，返回使"该轮结束后上场分布"最优的方案
 * @param {Array<Array<number>>} teams 本轮队伍
 * @param {Array<number>} plays 当前每人上场次数
 * @param {number} restCount 需要轮休的队伍数
 */
/**
 * 贪心轮休选择：本轮休息"累计上场次数之和最大"的 restCount 个队伍（平局随机），
 * 配合多次洗牌（pickBest）可达到完全均等（6 人 1 场 6 轮 → 每人 4 场）。
 * @param {Array<Array<number>>} teams 本轮队伍（每人一个下标）
 * @param {Array<number>} plays 当前每人上场次数
 * @param {number} playCount 本轮可上场的队伍数（2 × 场地数）
 */
function chooseRestGreedy(teams, plays, playCount) {
  const restCount = Math.max(0, teams.length - playCount);
  if (restCount <= 0) return new Set();
  const restSet = new Set();
  const order = teams
    .map((_, i) => i)
    .sort((a, b) => {
      const sa = plays[teams[a][0]] + plays[teams[a][1]];
      const sb = plays[teams[b][0]] + plays[teams[b][1]];
      return sb - sa || Math.random() - 0.5;
    });
  for (let i = 0; i < restCount; i++) restSet.add(order[i]);
  return restSet;
}

/** 统一入口：generate(players, type, courts, maxRounds) */
function generate(players, type, courts, maxRounds) {
  const mr = maxRounds && maxRounds > 0 ? maxRounds : null;
  if (type === 'singles') return generateSingles(players, courts, mr);
  if (type === 'doubles') return generateDoubles(players, courts, mr);
  if (type === 'mixed') return generateMixed(players, courts, mr);
  return { error: '未知的轮转类型' };
}

/**
 * 多次生成取上场分布最均衡的一次（max 最小、其次极差最小）
 * @param {Function} produce 生成函数（每次调用会重新洗牌）
 * @param {number} tries 尝试次数
 */
function pickBest(produce, tries) {
  let best = null;
  for (let t = 0; t < tries; t++) {
    const res = produce();
    if (!res || !res.ok) return res;
    const plays = res.stats.perPlayer.map(p => p.plays);
    const mx = Math.max(...plays);
    const mn = Math.min(...plays);
    const score = mx * 100 + (mx - mn);
    if (!best || score < best.score) {
      res.score = score;
      best = res;
      // 极差 0 = 每人场次完全均等，已达理论最优，无需继续尝试
      if (mx - mn === 0) break;
    }
  }
  return best;
}

// ---------- 单打 ----------

function generateSingles(players, courts, maxRounds) {
  const mr = maxRounds && maxRounds > 0 ? maxRounds : null;
  const n = players.length;
  if (n < 2) return { error: '单打至少需要 2 名球员' };
  const usableCourts = Math.min(courts, Math.floor(n / 2));
  if (usableCourts < 1) return { error: '没有可用的场地' };

  const perm = shuffle(Array.from({ length: n }, (_, i) => i));
  const m = n % 2 === 0 ? n : n + 1; // 奇数补虚拟球员产生轮空
  const dummy = n;

  const queue = [];
  const pushCycle = () => {
    circleRoundRobbin(m).forEach(pairs => {
      pairs.forEach(p => {
        if (p[0] === dummy || p[1] === dummy) return; // 虚拟球员的对手本轮轮空
        queue.push({ teamA: [perm[p[0]]], teamB: [perm[p[1]]] });
      });
    });
  };
  // 自定义轮数：循环圆桌周期，凑够需要的场次（对阵可重复）；自动模式：覆盖全部组合一次
  if (mr) {
    const needed = mr * usableCourts;
    while (queue.length < needed) pushCycle();
  } else {
    pushCycle();
  }

  const chunks = chunkByCourts(queue, usableCourts, mr);
  const rounds = chunks.map((matches, i) => ({
    no: i + 1,
    matches: matches.map((m, ci) => ({ ...m, court: ci + 1 })),
    waiting: computeWaiting(n, matches)
  }));

  const stats = buildStats(players, rounds);
  const totalMatches = rounds.reduce((s, r) => s + r.matches.length, 0);

  return {
    ok: true,
    type: 'singles',
    mode: mr ? 'custom' : 'auto',
    requestedRounds: mr,
    courts: usableCourts,
    rounds,
    stats,
    totalMatches,
    totalRounds: rounds.length,
    excluded: []
  };
}

// ---------- 双打 ----------

function generateDoubles(players, courts, maxRounds) {
  const mr = maxRounds && maxRounds > 0 ? maxRounds : null;
  const n = players.length;
  if (n < 4) return { error: '双打至少需要 4 名球员' };
  const usableCourts = Math.min(courts, Math.floor(n / 4));
  if (usableCourts < 1) return { error: '人数不足以凑满一块双打场地' };

  const build = () => {
    const perm = shuffle(Array.from({ length: n }, (_, i) => i));
    const m = n % 2 === 0 ? n : n + 1; // 奇数补虚拟球员
    const dummy = n;

    const queue = [];
    const plays = new Array(n).fill(0);
    // 先收集所有轮次的队伍，供带前瞻的轮休选择使用；自定义轮数时循环圆桌周期凑够轮数
    const roundTeamsList = [];
    const pushCycle = () => {
      circleRoundRobbin(m).forEach(pairs => {
        const teams = [];
        pairs.forEach(p => {
          if (p[0] === dummy || p[1] === dummy) return;
          teams.push([perm[p[0]], perm[p[1]]]);
        });
        roundTeamsList.push(teams);
      });
    };
    if (mr) {
      while (roundTeamsList.length < mr) pushCycle();
    } else {
      pushCycle();
    }
    const playCount = 2 * usableCourts;
    roundTeamsList.forEach(teams => {
      const restSet = chooseRestGreedy(teams, plays, playCount);
      const playing = teams.filter((_, i) => !restSet.has(i));
      for (let i = 0; i + 1 < playing.length; i += 2) {
        const tA = playing[i];
        const tB = playing[i + 1];
        queue.push({ teamA: tA.slice(), teamB: tB.slice() });
        plays[tA[0]]++;
        plays[tA[1]]++;
        plays[tB[0]]++;
        plays[tB[1]]++;
      }
    });

    const chunks = chunkByCourts(queue, usableCourts, mr);
    const rounds = chunks.map((matches, i) => ({
      no: i + 1,
      matches: matches.map((m, ci) => ({ ...m, court: ci + 1 })),
      waiting: computeWaiting(n, matches)
    }));
    const stats = buildStats(players, rounds);

    return {
      ok: true,
      type: 'doubles',
      mode: mr ? 'custom' : 'auto',
      requestedRounds: mr,
      courts: usableCourts,
      rounds,
      stats,
      totalMatches: rounds.reduce((s, r) => s + r.matches.length, 0),
      totalRounds: rounds.length,
      excluded: []
    };
  };
  return pickBest(build, 40);
}

// ---------- 混双 ----------

function generateMixed(players, courts, maxRounds) {
  const mr = maxRounds && maxRounds > 0 ? maxRounds : null;
  const maleIdx = [];
  const femaleIdx = [];
  const excluded = [];
  players.forEach((p, i) => {
    if (p.gender === 'male') maleIdx.push(i);
    else if (p.gender === 'female') femaleIdx.push(i);
    else excluded.push(i);
  });

  const usableCourts = Math.min(courts, Math.floor(Math.min(maleIdx.length, femaleIdx.length) / 2));
  if (usableCourts < 1) {
    return { error: '混双至少需要 2 男 2 女，且需先完善球员性别' };
  }

  const build = () => {
    const males = shuffle(maleIdx.slice());
    const females = shuffle(femaleIdx.slice());
    const M = males.length;
    const F = females.length;

    const queue = [];
    const plays = new Array(players.length).fill(0);
    // 男女错位轮转，覆盖全部 男×女 搭档组合；先收集各轮队伍供带前瞻的轮休选择
    const rotateOver = Math.max(M, F);
    const roundTeamsList = [];
    const totalNeeded = mr ? mr : rotateOver;
    for (let r = 0; r < totalNeeded; r++) {
      const teams = [];
      for (let i = 0; i < Math.min(M, F); i++) {
        if (M <= F) {
          teams.push([males[i], females[(i + r) % F]]);
        } else {
          teams.push([males[(i + r) % M], females[i]]);
        }
      }
      roundTeamsList.push(teams);
    }
    const playCount = 2 * usableCourts;
    roundTeamsList.forEach(teams => {
      const restSet = chooseRestGreedy(teams, plays, playCount);
      const playing = teams.filter((_, i) => !restSet.has(i));
      for (let i = 0; i + 1 < playing.length; i += 2) {
        const tA = playing[i];
        const tB = playing[i + 1];
        queue.push({ teamA: tA.slice(), teamB: tB.slice() });
        plays[tA[0]]++;
        plays[tA[1]]++;
        plays[tB[0]]++;
        plays[tB[1]]++;
      }
    });

    const chunks = chunkByCourts(queue, usableCourts, mr);
    const rounds = chunks.map((matches, i) => ({
      no: i + 1,
      matches: matches.map((m, ci) => ({ ...m, court: ci + 1 })),
      waiting: computeWaiting(players.length, matches)
    }));
    const stats = buildStats(players, rounds);

    return {
      ok: true,
      type: 'mixed',
      mode: mr ? 'custom' : 'auto',
      requestedRounds: mr,
      courts: usableCourts,
      rounds,
      stats,
      totalMatches: rounds.reduce((s, r) => s + r.matches.length, 0),
      totalRounds: rounds.length,
      excluded
    };
  };
  return pickBest(build, 40);
}

module.exports = { generate, generateSingles, generateDoubles, generateMixed };
