/**
 * 订阅消息配置（客户端与云函数共用同一份模板 ID）
 *
 * 使用前提（本人操作）：微信公众平台 → 功能 → 订阅消息 → 公共模板库选用，
 * 取得模板 ID 后填入下方 TMPL；留空时 requestSubs / 云函数发送都会安全跳过。
 * 模板字段（thing/phrase/number/time…）因模板而异，云函数 sendSub 的 data 需按实际模板字段填写。
 */
var TMPL = {
  pendingConfirm: '', // 「你有比赛待确认」
  dispute: '',        // 「球友对比分有异议」（发给组织者）
  settled: ''         // 「比赛已确认，段位更新」
};

/**
 * 客户端请求订阅授权（一次性模板，一次授权对应一次发送）。
 * 未配置模板 ID 或环境不支持时静默跳过，绝不阻塞主流程。
 */
function requestSubs(keys) {
  return new Promise(function (resolve) {
    try {
      var ids = (keys || []).map(function (k) { return TMPL[k]; }).filter(Boolean);
      if (!ids.length || typeof wx.requestSubscribeMessage !== 'function') {
        resolve();
        return;
      }
      wx.requestSubscribeMessage({ tmplIds: ids }).then(resolve).catch(function () { resolve(); });
    } catch (e) {
      resolve();
    }
  });
}

module.exports = { TMPL: TMPL, requestSubs: requestSubs };
