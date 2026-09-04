const request = require("./request");
const auth = require("./auth");

function phoneLogin(phoneCode) {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) {
          reject(new Error("登录失败"));
          return;
        }
        request
          .post(
            "/user/phone-login",
            { code: res.code, phoneCode: phoneCode },
            false,
          )
          .then((data) => {
            const saved = auth.saveUser(data)
            // New accounts receive a bundled avatar immediately. Persist it
            // so a later login restores the same choice instead of rerolling.
            const serverNickName = data.nickName || data.nick_name || ''
            const defaultFields = {}
            if (!data.avatarUrl && saved && saved.avatarUrl) defaultFields.avatarUrl = saved.avatarUrl
            if ((!serverNickName || serverNickName === '校园用户' || serverNickName === '微信用户') && saved && saved.nickName) {
              defaultFields.nickName = saved.nickName
            }
            if (Object.keys(defaultFields).length && !request.USE_MOCK) {
              return auth.syncProfile(defaultFields).catch(() => null).then(() => data)
            }
            return data
          })
          .then(resolve)
          .catch(reject);
      },
      fail: reject,
    });
  });
}

function checkContent(content) {
  return request
    .post("/user/content-check", { content }, true, { silent: true });
}

function updatePhone(phoneCode) {
  return request.post('/user/phone', { phoneCode }, true)
}

function uploadImages(filePaths) {
  const inst = getApp();
  const base = request.BASE_URL.replace("/api/v1", "");
  return Promise.all(
    filePaths.map(
      (filePath) =>
        new Promise((resolve, reject) => {
          wx.uploadFile({
            url: base + "/api/v1/user/upload/image",
            filePath,
            name: "file",
            header: { Authorization: "Bearer " + inst.globalData.token },
            timeout: 20000,
            success(res) {
              try {
                const data = JSON.parse(res.data);
                if (res.statusCode < 200 || res.statusCode >= 300 || !data.data || !data.data.url) {
                  reject(new Error((data && data.message) || '图片上传失败'))
                  return
                }
                const url = data.data.url;
                resolve(url.indexOf('/') === 0 ? base + url : url);
              } catch (e) {
                reject(new Error('图片上传响应无效'))
              }
            },
            fail: (error) => reject(new Error(error.errMsg || '图片上传失败')),
          });
        }),
    ),
  );
}

function previewImages(urls, current) {
  wx.previewImage({ urls, current: current || urls[0] });
}

// 隐私授权预检（符合微信开放平台规范）：
// 1. wx.getPrivacySetting 查询用户是否已同意《用户隐私保护指引》；
// 2. 未同意时通过 wx.requirePrivacyAuthorize 拉起官方隐私授权弹窗；
// 3. 用户拒绝授权时 resolve(false)，由调用方给出提示。
// 前提：需在 mp.weixin.qq.com「用户隐私保护指引」中声明"微信昵称""微信头像"收集类型，
// 否则相关接口会报 errno:112（api scope is not declared in the privacy agreement）。
function ensurePrivacyAuthorize() {
  return new Promise((resolve) => {
    if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
      resolve(true);
      return;
    }
    wx.getPrivacySetting({
      success(res) {
        if (!res || !res.needAuthorization) {
          resolve(true);
          return;
        }
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: () => resolve(false),
        });
      },
      fail: () => resolve(true),
    });
  });
}

module.exports = { phoneLogin, checkContent, updatePhone, uploadImages, previewImages, ensurePrivacyAuthorize };
