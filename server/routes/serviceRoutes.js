const express = require('express')
const router = express.Router()
const serviceController = require('../controllers/serviceController')

router.get('/list', serviceController.list)

module.exports = router
