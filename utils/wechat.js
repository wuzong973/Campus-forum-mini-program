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
        if (request.USE_MOCK) {
          const mockUser = {
            id: 1,
            nickName: "校园用户",
            avatarUrl: "",
            phone: "13800138000",
            token: "mock_token_" + Date.now(),
          };
          request
            .post(
              "/user/dev-login",
              { phone: mockUser.phone, nickName: mockUser.nickName },
              false,
              { silent: true },
            )
            .then((user) => {
              auth.saveUser(user || mockUser);
              resolve(user || mockUser);
            })
            .catch(() => {
              auth.saveUser(mockUser);
              resolve(mockUser);
            });
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
  if (request.USE_MOCK) return Promise.resolve({ safe: true });
  return request
    .post("/user/content-check", { content }, true, { silent: true })
    .catch(() => ({ safe: true }));
}

function uploadImages(filePaths) {
  if (request.USE_MOCK) return Promise.resolve(filePaths);
  const inst = getApp();
  const base = request.BASE_URL.replace("/api/v1", "");
  return Promise.all(
    filePaths.map(
      (filePath) =>
        new Promise((resolve) => {
          wx.uploadFile({
            url: base + "/api/v1/user/upload/image",
            filePath,
            name: "file",
            header: { Authorization: "Bearer " + inst.globalData.token },
            success(res) {
              try {
                const data = JSON.parse(res.data);
                resolve(data.data && data.data.url ? data.data.url : filePath);
              } catch (e) {
                resolve(filePath);
              }
            },
            fail: () => resolve(filePath),
          });
        }),
    ),
  );
}

function previewImages(urls, current) {
  wx.previewImage({ urls, current: current || urls[0] });
}

module.exports = { phoneLogin, checkContent, uploadImages, previewImages };
