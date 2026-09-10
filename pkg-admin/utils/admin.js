const request = require('../../utils/request')

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
  reviewRiderVerification: (id, action, note) => post('/rider-verifications/' + id + '/review', { action, note: note || '' }),
  admins: () => get('/admins'),
  createAdmin: (query, role) => post('/admins', { query, role }),
  auditLogs: (data) => get('/audit-logs', data),
  errandOrders: (data) => get('/errand-orders', data),
  errandOrderDetail: (id) => get('/errand-orders/' + id),
  // 社团&组织管理
  clubCategories: () => get('/club/categories'),
  createClubCategory: (data) => post('/club/categories', data),
  updateClubCategory: (id, data) => put('/club/categories/' + id, data),
  deleteClubCategory: (id) => del('/club/categories/' + id),
  createClub: (data) => post('/club/clubs', data),
  updateClub: (id, data) => put('/club/clubs/' + id, data),
  deleteClub: (id) => del('/club/clubs/' + id),
  // 广轻群聊管理
  groupChatApplies: (data) => get('/group-chat/applies', data),
  reviewGroupChatApply: (id, action, note) => post('/group-chat/applies/' + id + '/review', { action, note: note || '' }),
  groupChatGroups: (data) => get('/group-chat/groups', data),
  createGroupChatGroup: (data) => post('/group-chat/groups', data),
  updateGroupChatGroup: (id, data) => put('/group-chat/groups/' + id, data),
  deleteGroupChatGroup: (id) => del('/group-chat/groups/' + id),
  // 校园活动管理
  activities: (data) => get('/activities', data),
  updateActivity: (id, data) => put('/activities/' + id, data),
  deleteActivity: (id) => del('/activities/' + id)
}
