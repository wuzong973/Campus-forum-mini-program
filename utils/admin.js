const request = require('./request')

const get = (path, data) => request.get('/admin' + path, data || {}, true)
const post = (path, data) => request.post('/admin' + path, data || {}, true)
const put = (path, data) => request.put('/admin' + path, data || {}, true)
const del = (path, data) => request.del('/admin' + path, data || {}, true)

module.exports = {
  me: () => get('/me'),
  stats: () => get('/stats'),
  reports: (data) => get('/reports', data),
  updateReport: (id, status, note) => put('/reports/' + id, { status, note: note || '' }),
  posts: (data) => get('/posts', data),
  updatePost: (id, data) => put('/posts/' + id, data),
  postAction: (id, action) => post('/posts/' + id + '/action', { action }),
  batchPostAction: (ids, action) => post('/posts/batch-action', { ids, action }),
  content: (type) => get('/content', type ? { type } : {}),
  createContent: (data) => post('/content', data),
  updateContent: (id, data) => put('/content/' + id, data),
  deleteContent: (id) => del('/content/' + id),
  features: () => get('/features'),
  saveFeature: (data) => put('/features', data),
  items: () => get('/items'),
  createItem: (data) => post('/items', data),
  updateItem: (id, data) => put('/items/' + id, data),
  users: (data) => get('/users', data),
  updateUserStatus: (id, status) => put('/users/' + id + '/status', { status }),
  updateUserRole: (id, role) => put('/users/' + id + '/role', { role }),
  withdrawals: (data) => get('/withdrawals', data),
  reviewWithdrawal: (id, action, note) => post('/withdrawals/' + id + '/review', { action, note: note || '' }),
  updateCertLabel: (id, certLabel) => put('/users/' + id + '/cert-label', { certLabel: certLabel || '' }),
  riderVerifications: (data) => get('/rider-verifications', data),
  reviewRiderVerification: (id, action, note) => post('/rider-verifications/' + id + '/review', { action, note: note || '' })
}
