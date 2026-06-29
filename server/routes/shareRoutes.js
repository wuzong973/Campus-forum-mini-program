const express = require('express')
const router = express.Router()
const shareController = require('../controllers/shareController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.post('/', auth, contentSecurity, shareController.create)
router.get('/:id', shareController.list)
router.delete('/:id', auth, shareController.remove)

module.exports = router
