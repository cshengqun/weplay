/**
 * 比赛结果确认状态机验证（node 运行）
 * 维度：自动确认降级、required 计算、确认流程、异议、修改重置、老数据自愈、汇总
 */
const cf = require('../utils/confirm');

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

const NOW = 1700000000000;

// 单打：甲(oa) vs 乙(ob)
const singlesMatch = { court: 1, teamA: [0], teamB: [1] };
const singlesPlayers = [{ name: '甲', openid: 'oa' }, { name: '乙', openid: 'ob' }];

// 双打：甲乙 vs 丙丁
const doublesMatch = { court: 1, teamA: [0, 1], teamB: [2, 3] };
const doublesPlayers = [
  { name: '甲', openid: 'oa' },
  { name: '乙', openid: 'ob' },
  { name: '丙', openid: 'oc' },
  { name: '丁', openid: 'od' }
];

// 手动名单（无 openid）
const manualMatch = { court: 1, teamA: [0], teamB: [1] };
const manualPlayers = [{ name: '甲' }, { name: '乙' }];

console.log('【自动确认降级】');
{
  const r = cf.buildRecord(21, 18, { match: manualMatch, players: manualPlayers, submitterOpenid: '', now: NOW });
  assert('无 openid 参与者 → 自动确认', r.status === 'confirmed', r);
  assert('自动确认写入 confirmedAt', r.confirmedAt === NOW);
  assert('自动确认 required 为空', Array.isArray(r.required) && r.required.length === 0);
}

console.log('【单打确认流程】');
{
  let r = cf.buildRecord(21, 18, { match: singlesMatch, players: singlesPlayers, submitterOpenid: 'oa', now: NOW });
  assert('有 openid 对手 → pending', r.status === 'pending', r);
  assert('required 排除录入者', JSON.stringify(r.required) === JSON.stringify(['ob']), r.required);
  assert('待确认方能 canIConfirm', cf.canIConfirm(r, 'ob') === true);
  assert('录入者无需确认', cf.canIConfirm(r, 'oa') === false);
  assert('路人不能确认', cf.canIConfirm(r, 'ox') === false);

  const confirmed = cf.confirm(r, 'ob', NOW + 1);
  assert('唯一待确认方确认 → confirmed', confirmed.status === 'confirmed', confirmed);
  assert('确认写入 confirmedAt', confirmed.confirmedAt === NOW + 1);

  const noop = cf.confirm(r, 'ox');
  assert('非相关方确认无效（返回原记录）', noop === r);
}

console.log('【双打确认流程】');
{
  let r = cf.buildRecord(21, 15, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW });
  assert('required 为除录入者外三人', r.required.length === 3 && r.required.indexOf('oa') < 0, r.required);

  let p = cf.confirm(r, 'ob');
  assert('一人确认仍 pending', p.status === 'pending' && p.confirmedBy.length === 1, p);
  assert('同一人重复确认不重复计数', cf.confirm(p, 'ob').confirmedBy.length === 1);

  p = cf.confirm(p, 'oc');
  p = cf.confirm(p, 'od', NOW + 2);
  assert('三人全部确认 → confirmed', p.status === 'confirmed', p);
}

console.log('【异议流程】');
{
  const r = cf.buildRecord(21, 15, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW });
  const d = cf.dispute(r, 'oc', '比分应为 21:19', NOW + 3);
  assert('参与者异议 → disputed', d.status === 'disputed', d);
  assert('异议内容被记录', d.dispute && d.dispute.by === 'oc' && d.dispute.reason === '比分应为 21:19');

  const d2 = cf.confirm(d, 'ob');
  assert('争议态下其他人确认不解除争议', d2.status === 'disputed');

  const d3 = cf.dispute(r, 'ox');
  assert('非参与者异议无效（返回原记录）', d3 === r);
}

console.log('【修改比分重置】');
{
  const r = cf.buildRecord(21, 15, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW });
  const confirmedPartly = cf.confirm(r, 'ob');
  const fixed = cf.buildRecord(21, 19, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW + 4 });
  assert('修改比分后回到 pending', fixed.status === 'pending', fixed);
  assert('修改后 confirmedBy 清空', fixed.confirmedBy.length === 0);
  assert('修改后旧异议清除', !fixed.dispute);
}

console.log('【老数据自愈】');
{
  assert('老数据有比分无 status → confirmed', cf.normalizeRecord({ sA: 21, sB: 18 }).status === 'confirmed');
  assert('老数据 0:0 无 status → pending', cf.normalizeRecord({ sA: 0, sB: 0 }).status === 'pending');
  assert('normalize 补齐 required 数组', Array.isArray(cf.normalizeRecord({ sA: 21, sB: 18 }).required));
  assert('normalize 补齐 confirmedBy 数组', Array.isArray(cf.normalizeRecord({ sA: 21, sB: 18 }).confirmedBy));
  assert('已有 status 原样保留', cf.normalizeRecord({ sA: 21, sB: 18, status: 'pending' }).status === 'pending');
}

console.log('【身份与汇总】');
{
  const r = cf.buildRecord(21, 15, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW });
  assert('isParticipant 录入者', cf.isParticipant(r, 'oa') === true);
  assert('isParticipant 其他参与者', cf.isParticipant(r, 'od') === true);
  assert('isParticipant 路人', cf.isParticipant(r, 'ox') === false);

  const rotation = {
    scores: {
      '1-1': cf.buildRecord(21, 18, { match: singlesMatch, players: singlesPlayers, submitterOpenid: 'oa', now: NOW }),
      '1-2': cf.buildRecord(21, 15, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW })
    }
  };
  const s = cf.summarize(rotation);
  assert('两场均 pending', s.pending === 2 && s.confirmed === 0, s);

  rotation.scores['1-1'] = cf.confirm(rotation.scores['1-1'], 'ob');
  const s2 = cf.summarize(rotation);
  assert('确认一场后 confirmed=1 pending=1', s2.confirmed === 1 && s2.pending === 1, s2);
}

console.log('【超时自动确认】');
{
  const TIMEOUT = 48 * 60 * 60 * 1000;
  const pending = cf.buildRecord(21, 18, { match: singlesMatch, players: singlesPlayers, submitterOpenid: 'oa', now: NOW });
  assert('未到超时不自动确认', cf.shouldAutoConfirm(pending, NOW + TIMEOUT - 1, TIMEOUT) === false);
  assert('刚好到超时可自动确认', cf.shouldAutoConfirm(pending, NOW + TIMEOUT, TIMEOUT) === true);
  assert('超过超时可自动确认', cf.shouldAutoConfirm(pending, NOW + TIMEOUT + 99999, TIMEOUT) === true);

  const confirmed = cf.confirm(pending, 'ob', NOW + 1);
  assert('已确认不再自动确认', cf.shouldAutoConfirm(confirmed, NOW + TIMEOUT * 2, TIMEOUT) === false);
  const disputed = cf.dispute(pending, 'ob', '比分错', NOW + 1);
  assert('有异议即使超时也不自动确认', cf.shouldAutoConfirm(disputed, NOW + TIMEOUT * 2, TIMEOUT) === false);
  assert('无 submittedAt 不自动确认', cf.shouldAutoConfirm({ status: 'pending', required: ['ob'] }, NOW + TIMEOUT, TIMEOUT) === false);

  const auto = cf.autoConfirm(pending, NOW + TIMEOUT);
  assert('自动确认后 status=confirmed', auto.status === 'confirmed');
  assert('单打自动确认补齐 required', auto.confirmedBy.length === 1 && auto.confirmedBy[0] === 'ob', auto.confirmedBy);
  assert('自动确认标记 autoConfirmed', auto.autoConfirmed === true);
  assert('自动确认写 confirmedAt', auto.confirmedAt === NOW + TIMEOUT);
  assert('自动确认不改原 record（不可变）', pending.status === 'pending' && pending.autoConfirmed !== true);

  const dPending = cf.buildRecord(21, 15, { match: doublesMatch, players: doublesPlayers, submitterOpenid: 'oa', now: NOW });
  const dAuto = cf.autoConfirm(dPending, NOW + TIMEOUT);
  assert('双打自动确认补齐全部 required（3 人）', dAuto.confirmedBy.length === 3, dAuto.confirmedBy);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
