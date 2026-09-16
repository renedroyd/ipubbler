# ipubbler

Plataforma de publicación y gestión de contenidos sociales, orientada a automatizar publicaciones y mantener el control de la infraestructura.

## Fase 1

La primera fase establece el núcleo del producto:

- Panel web con Vue 3 + Vite.
- API sobre Cloudflare Workers + Hono.
- Persistencia preparada para Cloudflare D1.
- Almacenamiento multimedia preparado para Cloudflare R2.
- Scheduler mediante Cron Trigger cada minuto.
- Modelo de usuarios, sesiones, publicaciones, multimedia y logs.
- Estados: `draft`, `scheduled`, `processing`, `published`, `failed`.

La integración con Facebook/Meta se implementará después mediante un adaptador de publicación, sin acoplar el dominio de publicaciones al proveedor.

## Estructura

```text
ipubbler/
├── apps/
│   ├── api/       # Cloudflare Worker
│   └── web/       # Vue 3 + Vite
├── database/
│   └── migrations/
└── package.json
```

## Desarrollo

Requisitos: Node.js 20+ y Wrangler.

```bash
npm install
npm run dev:web
```

Para el API:

```bash
npm run dev:api
```

Antes del despliegue se deben crear y enlazar una base D1 y un bucket R2 en `apps/api/wrangler.toml`.
