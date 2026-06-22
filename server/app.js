require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const path = require('path')
const jwtConfig = require('./config/jwt')
const pool = require('./config/pool')
const logger = require('./middleware/logger')
const errorHandler = require('./middleware/errorHandler')
const rateLimit = require('./middleware/rateLimit')
const { fail } = require('./middleware/auth')

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('生产环境必须设置 JWT_SECRET')
  process.exit(1)
}

const userRoutes = require('./routes/userRoutes')
const postRoutes = require('./routes/postRoutes')
const commentRoutes = require('./routes/commentRoutes')
const scheduleRoutes = require('./routes/scheduleRoutes')
const errandRoutes = require('./routes/errandRoutes')
const serviceRoutes = require('./routes/serviceRoutes')

const app = express()
const PORT = process.env.PORT || 3000

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*'
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(logger)
app.use(rateLimit({ max: 120 }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

app.get('/api/v1/health', async (req, res) => {
  let dbOk = false
  try {
    await pool.query('SELECT 1')
    dbOk = true
  } catch (e) { /* ignore */ }
  res.json({ code: 200, message: 'ok', data: { status: 'running', database: dbOk } })
})

app.use('/api/v1/user', userRoutes)
app.use('/api/v1/post', postRoutes)
app.use('/api/v1/comment', commentRoutes)
app.use('/api/v1/schedule', scheduleRoutes)
app.use('/api/v1/errand', errandRoutes)
app.use('/api/v1/service', serviceRoutes)

app.use('/api/v1/*', (req, res) => fail(res, '接口不存在', 404))

app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`广轻工后端服务运行在端口 ${PORT}`)
})

function shutdown() {
  server.close(() => {
    pool.end().then(() => process.exit(0))
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

module.exports = app
