const express = require('express')
const router = express.Router()
const commentController = require('../controllers/commentController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.get('/list', commentController.list)
router.post('/', auth, contentSecurity, commentController.create)
router.delete('/:id', auth, commentController.remove)

module.exports = router
