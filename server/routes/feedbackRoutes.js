const express = require('express')
const router = express.Router()
const controller = require('../controllers/feedbackController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.post('/', auth, contentSecurity, controller.create)
router.post('/report', auth, contentSecurity, controller.report)

module.exports = router
