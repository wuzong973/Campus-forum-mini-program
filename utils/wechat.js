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
            auth.saveUser(data);
            resolve(data);
          })
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

module.exports = { phoneLogin, checkContent, updatePhone, uploadImages, previewImages };
