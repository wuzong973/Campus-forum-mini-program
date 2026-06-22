const express = require('express')
const router = express.Router()
const errandController = require('../controllers/errandController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.get('/list', errandController.list)
router.post('/', auth, contentSecurity, errandController.create)
router.post('/:id/accept', auth, errandController.accept)
router.post('/:id/finish', auth, errandController.finish)

module.exports = router
