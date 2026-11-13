/**
 * 本地存储封装（微信小程序 wx.storage 同步接口）
 * 数据模型：
 * activities: [{
 *   id, name, date, courts, createdAt,
 *   players: [{ id, name, gender: 'male'|'female'|'', level: 'beginner'|'mid'|'pro'|'' }],
 *   rotations: {
 *     singles: null | { players: [快照], rounds, stats, courts, mode, totalMatches, totalRounds, excluded },
 *     doubles: null | {...},
 *     mixed:   null | {...}
 *   }
 * }]
 */
const KEY = 'weplay_activities_v2';

function getActivities() {
  try {
    return wx.getStorageSync(KEY) || [];
  } catch (e) {
    return [];
  }
}

function saveActivities(list) {
  wx.setStorageSync(KEY, list);
}

function genId(prefix) {
  return (prefix || 'a') + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

function getActivity(id) {
  return getActivities().find(a => a.id === id) || null;
}

function upsertActivity(activity) {
  const list = getActivities();
  const idx = list.findIndex(a => a.id === activity.id);
  if (idx >= 0) {
    list[idx] = activity;
  } else {
    list.unshift(activity);
  }
  saveActivities(list);
  return activity;
}

function deleteActivity(id) {
  const list = getActivities().filter(a => a.id !== id);
  saveActivities(list);
}

function setRotation(activityId, type, rotation) {
  const act = getActivity(activityId);
  if (!act) return;
  if (!act.rotations) act.rotations = { singles: null, doubles: null, mixed: null };
  act.rotations[type] = rotation;
  upsertActivity(act);
}

function clearRotation(activityId, type) {
  const act = getActivity(activityId);
  if (!act) return;
  if (act.rotations) act.rotations[type] = null;
  upsertActivity(act);
}

module.exports = {
  KEY,
  getActivities,
  getActivity,
  upsertActivity,
  deleteActivity,
  setRotation,
  clearRotation,
  saveActivities,
  genId
};
