import { Hono } from 'hono'

const app = new Hono()

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    service: 'ipubbler-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

app.get('/api', (c) => c.json({ name: 'ipubbler', status: 'online' }))

export default app
