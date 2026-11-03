const express = require('express')
const router = express.Router()
const controller = require('../controllers/coupleController')
const { auth } = require('../middleware/auth')

router.get('/current', auth, controller.current)
router.post('/signup', auth, controller.signup)
router.get('/match/:id', auth, controller.matchDetail)
router.post('/rematch', auth, controller.rematch)
router.get('/history', auth, controller.history)

module.exports = router
