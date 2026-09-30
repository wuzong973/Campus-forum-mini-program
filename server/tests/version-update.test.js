const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(root, 'utils', 'version-update.js'), 'utf8')

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function loadUtility({ remoteVersion = '1.2.3', localVersion = '1.0.0' } = {}) {
  let readyHandler = null
  let applyCalls = 0
  const storage = {
    token: 'test-token',
    userInfo: { id: 9 },
    'app_update_dismissed': ''
  }
  const wxStub = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    showToast: () => {},
    getAccountInfoSync: () => ({ miniProgram: { version: localVersion } }),
    getUpdateManager: () => ({
      onUpdateReady: (fn) => { readyHandler = fn },
      onUpdateFailed: () => {},
      applyUpdate: () => { applyCalls += 1 }
    })
  }
  const sandbox = {
    module: { exports: {} },
    console,
    Promise,
    setTimeout,
    require: (name) => {
      if (name.endsWith('request')) {
        return { get: () => Promise.resolve({ version: remoteVersion }) }
      }
      return {}
    },
    wx: wxStub
  }
  vm.runInNewContext(source, sandbox, { filename: 'utils/version-update.js' })
  return {
    util: sandbox.module.exports,
    storage,
    get readyHandler() { return readyHandler },
    get applyCalls() { return applyCalls }
  }
}

async function run() {
  const context = loadUtility()
  const prompts = []
  const shown = await context.util.checkForUpdate((info) => prompts.push(info))
  assert.strictEqual(shown, false, '更新包未下载完成时不得提示')
  assert.strictEqual(typeof context.readyHandler, 'function', '更新管理器事件应已注册')

  context.readyHandler()
  await sleep(0)
  assert.strictEqual(prompts.length, 1, '更新包 ready 后应提示一次')
  assert.strictEqual(prompts[0].latestVersion, '1.2.3')
  assert.strictEqual(prompts[0].localVersion, '1.0.0')

  context.util.restart()
  assert.strictEqual(context.applyCalls, 1, '确认后应调用 applyUpdate')

  context.util.markVersionDismissed(prompts[0].latestVersion)
  const secondPrompts = []
  await context.util.checkForUpdate((info) => secondPrompts.push(info))
  assert.strictEqual(secondPrompts.length, 0, '同一版本点击稍后后不得重复弹窗')

  const guest = loadUtility()
  guest.storage.token = ''
  const guestPrompts = []
  await guest.util.checkForUpdate((info) => guestPrompts.push(info))
  await sleep(0)
  assert.strictEqual(guestPrompts.length, 0, '未登录用户不得收到更新弹窗')

  console.log('PASS: 版本更新提醒机制')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})



