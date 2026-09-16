<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type Destination, type Media, type Post, type PublicationLog, type User } from './api'

const user = ref<User | null>(null)
const loading = ref(true)
const saving = ref(false)
const loginError = ref('')
const email = ref('')
const password = ref('')
const content = ref('')
const scheduledAt = ref('')
const posts = ref<Post[]>([])
const stats = ref({ scheduled: 0, published: 0, draft: 0, failed: 0, processing: 0 })
const view = ref('dashboard')
const editingId = ref<string | null>(null)
const selectedPostId = ref<string | null>(null)
const media = ref<Media[]>([])
const logs = ref<PublicationLog[]>([])
const destinations = ref<Destination[]>([])
const selectedDestinationIds = ref<string[]>([])
const metaConfigured = ref(false)
const metaAccounts = ref<{ id: string; name: string }[]>([])
const metaToken = ref('')
const metaMessage = ref('')
const selectedFiles = ref<File[]>([])
const uploadError = ref('')
const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'posts', label: 'Publicaciones', icon: '▣' },
  { id: 'calendar', label: 'Calendario', icon: '□' },
  { id: 'media', label: 'Multimedia', icon: '◈' },
  { id: 'history', label: 'Historial', icon: '↺' },
  { id: 'destinations', label: 'Destinos', icon: '◎' },
]

const selectedPost = computed(() => posts.value.find(p => p.id === selectedPostId.value) ?? null)
const imagePosts = computed(() => posts.value.filter(p => p.content))
const selectedDestinationNames = computed(() => destinations.value.filter(d => selectedDestinationIds.value.includes(d.id)).map(d => d.name))

async function loadData() {
  const me = await api.me(); user.value = me.user
  if (!user.value) return
  const [postData, statData, meta] = await Promise.all([api.posts(), api.stats(), api.metaStatus()])
  posts.value = postData.posts
  stats.value = statData.stats as typeof stats.value
  metaConfigured.value = meta.configured
  metaAccounts.value = meta.accounts
  destinations.value = meta.destinations
}
async function loadDestinations() {
  const meta = await api.metaStatus()
  metaConfigured.value = meta.configured
  metaAccounts.value = meta.accounts
  destinations.value = meta.destinations
}
async function login() {
  loginError.value = ''; loading.value = true
  try { await api.login(email.value, password.value); await loadData() }
  catch (e) { loginError.value = e instanceof Error ? e.message : 'No fue posible iniciar sesión' }
  finally { loading.value = false }
}
async function logout() { await api.logout(); user.value = null }
function resetComposer() { editingId.value = null; content.value = ''; scheduledAt.value = ''; selectedFiles.value = []; selectedDestinationIds.value = []; uploadError.value = '' }
async function editPost(post: Post) {
  editingId.value = post.id; content.value = post.content; scheduledAt.value = post.scheduled_at ? toLocalInput(post.scheduled_at) : ''; selectedFiles.value = []; uploadError.value = ''
  try { selectedDestinationIds.value = (await api.postDestinations(post.id)).destinations.map(d => d.id) } catch { selectedDestinationIds.value = [] }
  view.value = 'posts'; window.scrollTo({ top: 0, behavior: 'smooth' })
}
function toLocalInput(iso: string) {
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFiles.value = Array.from(input.files ?? [])
  uploadError.value = ''
}
async function uploadForPost(postId: string) {
  for (const file of selectedFiles.value) await api.uploadMedia(postId, file)
  selectedFiles.value = []
  media.value = (await api.media(postId)).media
}
async function savePost() {
  if (!content.value.trim()) return
  saving.value = true; uploadError.value = ''
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const iso = scheduledAt.value ? new Date(scheduledAt.value).toISOString() : null
    let post: Post
    if (editingId.value) post = (await api.updatePost(editingId.value, { content: content.value, scheduled_at: iso, timezone })).post
    else post = (await api.createPost(content.value, iso, timezone)).post
    if (selectedFiles.value.length) await uploadForPost(post.id)
    await api.setPostDestinations(post.id, selectedDestinationIds.value)
    resetComposer(); await loadData()
  } catch (e) { uploadError.value = e instanceof Error ? e.message : 'No fue posible guardar la publicación' }
  finally { saving.value = false }
}
async function removePost(id: string) { if (!confirm('¿Eliminar esta publicación y sus imágenes?')) return; await api.deletePost(id); if (selectedPostId.value === id) selectedPostId.value = null; await loadData() }
async function openPost(post: Post) {
  selectedPostId.value = post.id
  const [mediaData, logData, destinationData] = await Promise.all([api.media(post.id), api.logs(post.id), api.postDestinations(post.id)])
  media.value = mediaData.media; logs.value = logData.logs; selectedDestinationIds.value = destinationData.destinations.map(d => d.id)
}
async function removeMedia(id: string) { await api.deleteMedia(id); if (selectedPostId.value) media.value = (await api.media(selectedPostId.value)).media }
async function refreshLogs() { if (selectedPostId.value) logs.value = (await api.logs(selectedPostId.value)).logs }
async function connectMeta() {
  metaMessage.value = ''
  if (!metaToken.value.trim()) { metaMessage.value = 'Introduce un access token para conectar Meta.'; return }
  try {
    const result = await api.connectMeta(metaToken.value.trim())
    metaToken.value = ''
    metaMessage.value = `Conectado: ${result.pages.length} página(s) importada(s).`
    await loadDestinations()
  } catch (e) { metaMessage.value = e instanceof Error ? e.message : 'No fue posible conectar Meta.' }
}
async function removeDestination(destination: Destination) {
  if (!confirm(`¿Desconectar el destino «${destination.name}»?`)) return
  try { await api.deleteDestination(destination.id); destinations.value = destinations.value.filter(d => d.id !== destination.id); selectedDestinationIds.value = selectedDestinationIds.value.filter(id => id !== destination.id) }
  catch (e) { metaMessage.value = e instanceof Error ? e.message : 'No fue posible eliminar el destino.' }
}
onMounted(async () => { try { await loadData() } catch { user.value = null } finally { loading.value = false } })
</script>

<template>
  <div v-if="loading" class="loading-screen">Cargando ipubbler…</div>
  <div v-else-if="!user" class="login-screen"><form class="login-card" @submit.prevent="login"><div class="brand large"><span class="brand-mark">i</span><span>ipubbler</span></div><h1>Iniciar sesión</h1><p>Administra tus publicaciones desde un solo lugar.</p><label>Email<input v-model="email" type="email" autocomplete="email" required></label><label>Contraseña<input v-model="password" type="password" autocomplete="current-password" required></label><div v-if="loginError" class="error">{{ loginError }}</div><button class="primary full" :disabled="loading">Entrar</button></form></div>
  <div v-else class="app-shell">
    <aside class="sidebar"><div class="brand"><span class="brand-mark">i</span><span>ipubbler</span></div><nav><button v-for="item in menu" :key="item.id" :class="['nav-item', { active: view === item.id }]" @click="view = item.id"><span>{{ item.icon }}</span>{{ item.label }}</button></nav><div class="sidebar-footer"><strong>{{ user.name }}</strong><button @click="logout">Cerrar sesión</button></div></aside>
    <main class="main"><header class="topbar"><div><p class="eyebrow">PUBLICADOR SOCIAL</p><h1>{{ menu.find(m => m.id === view)?.label }}</h1></div><button class="avatar">{{ user.name.charAt(0).toUpperCase() }}</button></header>
      <section v-if="view === 'dashboard'" class="content"><div class="welcome"><div><h2>Tu centro de publicaciones</h2><p>Planifica y administra tu contenido desde un solo lugar.</p></div><button class="primary" @click="view = 'posts'; resetComposer()">+ Nueva publicación</button></div><div class="stats"><article><span>Programadas</span><strong>{{ stats.scheduled }}</strong><small>pendientes</small></article><article><span>Publicadas</span><strong>{{ stats.published }}</strong><small>publicadas</small></article><article><span>Borradores</span><strong>{{ stats.draft }}</strong><small>para continuar</small></article><article><span>Fallidas</span><strong>{{ stats.failed }}</strong><small>requieren atención</small></article></div><div class="panel"><div class="panel-head"><h3>Próximas publicaciones</h3><button @click="view = 'posts'">Ver publicaciones →</button></div><div v-if="posts.filter(p => p.status === 'scheduled').length" class="post-list"><div v-for="post in posts.filter(p => p.status === 'scheduled').slice(0, 5)" :key="post.id" class="post-row"><div><strong>{{ new Date(post.scheduled_at!).toLocaleString() }}</strong><p>{{ post.content }}</p></div><span class="badge scheduled">programada</span></div></div><div v-else class="empty"><div class="empty-icon">✦</div><h3>Aún no hay publicaciones programadas</h3><p>Crea tu primera publicación y prográmala para una fecha y hora.</p><button class="secondary" @click="view = 'posts'">Crear publicación</button></div></div></section>

      <section v-else-if="view === 'posts'" class="content"><div class="panel composer"><div class="panel-head"><h2>{{ editingId ? 'Editar publicación' : 'Nueva publicación' }}</h2><span>Fase 1</span></div><textarea v-model="content" maxlength="5000" placeholder="¿Qué quieres publicar?"></textarea><div class="file-picker"><label>Imágenes <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple @change="handleFiles"></label><small>JPG, PNG, WebP o GIF · máximo 10 MB por imagen</small><ul v-if="selectedFiles.length"><li v-for="file in selectedFiles" :key="file.name + file.size">{{ file.name }} ({{ Math.round(file.size / 1024) }} KB)</li></ul></div><div v-if="destinations.length" class="destination-picker"><div><strong>Destinos</strong><small>Selecciona dónde se publicará este contenido.</small></div><label v-for="destination in destinations" :key="destination.id" class="destination-option"><input v-model="selectedDestinationIds" type="checkbox" :value="destination.id"><span><strong>{{ destination.name }}</strong><small>{{ destination.type === 'page' ? 'Página de Facebook' : destination.type }}</small></span></label></div><div v-else class="notice">No hay destinos conectados. Puedes guardar el contenido como borrador y conectar Meta desde <button @click="view = 'destinations'">Destinos</button>.</div><div v-if="uploadError" class="error">{{ uploadError }}</div><div class="composer-footer"><label>Fecha y hora (opcional)<input v-model="scheduledAt" type="datetime-local"></label><div class="actions"><button v-if="editingId" class="secondary" @click="resetComposer">Cancelar</button><button class="primary" :disabled="saving" @click="savePost">{{ saving ? 'Guardando…' : scheduledAt ? 'Programar' : 'Guardar borrador' }}</button></div></div></div><div class="panel"><div class="panel-head"><h3>Mis publicaciones</h3><span>{{ posts.length }}</span></div><div v-if="posts.length" class="post-list"><div v-for="post in posts" :key="post.id" class="post-row"><div><span :class="['badge', post.status]">{{ post.status }}</span><p>{{ post.content }}</p><small v-if="post.scheduled_at">{{ new Date(post.scheduled_at).toLocaleString() }}</small></div><div class="row-actions"><button class="secondary" @click="openPost(post)">Detalle</button><button class="secondary" @click="editPost(post)">Editar</button><button class="danger" @click="removePost(post.id)">Eliminar</button></div></div></div><div v-else class="empty"><p>No tienes publicaciones todavía.</p></div></div>
        <div v-if="selectedPost" class="panel detail"><div class="panel-head"><div><h3>Detalle de publicación</h3><small>{{ selectedPost.status }} · {{ selectedPost.timezone }}</small></div><button @click="selectedPostId = null">Cerrar</button></div><p>{{ selectedPost.content }}</p><div v-if="selectedDestinationNames.length" class="destination-summary"><strong>Destinos:</strong> {{ selectedDestinationNames.join(', ') }}</div><div v-if="media.length" class="media-grid"><figure v-for="item in media" :key="item.id"><img :src="api.mediaUrl(item.id)" :alt="item.filename"><figcaption><span>{{ item.filename }}</span><button class="danger" @click="removeMedia(item.id)">Eliminar</button></figcaption></figure></div><div class="logs"><div class="panel-head"><h4>Historial</h4><button @click="refreshLogs">Actualizar</button></div><div v-if="logs.length"><div v-for="log in logs" :key="log.id" class="log-row"><span :class="['badge', log.status]">{{ log.status }}</span><div><strong>{{ new Date(log.created_at).toLocaleString() }}</strong><p>{{ log.message }}</p></div></div></div><p v-else>No hay eventos registrados.</p></div></div></section>

      <section v-else-if="view === 'media'" class="content"><div class="panel"><div class="panel-head"><h2>Multimedia</h2><span>{{ imagePosts.length }} publicaciones</span></div><p class="muted">Las imágenes se almacenan de forma privada en R2 y se sirven únicamente a usuarios autenticados.</p><div v-if="imagePosts.length" class="post-list"><div v-for="post in imagePosts" :key="post.id" class="post-row"><div><span :class="['badge', post.status]">{{ post.status }}</span><p>{{ post.content }}</p></div><button class="secondary" @click="openPost(post)">Ver archivos</button></div></div><div v-else class="empty"><p>No hay publicaciones con contenido todavía.</p></div></div></section>
      <section v-else-if="view === 'history'" class="content"><div class="panel"><div class="panel-head"><h2>Historial</h2><button @click="loadData">Actualizar</button></div><div v-if="posts.length" class="post-list"><div v-for="post in posts" :key="post.id" class="post-row"><div><span :class="['badge', post.status]">{{ post.status }}</span><p>{{ post.content }}</p><small v-if="post.error_message">{{ post.error_message }}</small></div><button class="secondary" @click="openPost(post)">Ver historial</button></div></div><div v-else class="empty"><p>No hay publicaciones.</p></div></div></section>

      <section v-else-if="view === 'destinations'" class="content"><div class="panel"><div class="panel-head"><div><h2>Destinos</h2><p class="muted">Gestiona las cuentas y páginas disponibles para tus publicaciones.</p></div><span :class="['badge', metaConfigured ? 'published' : 'failed']">{{ metaConfigured ? 'Meta configurado' : 'Meta no configurado' }}</span></div><div class="connect-card"><h3>Conectar Meta</h3><p>El token se envía directamente al Worker y no se muestra ni se guarda en el navegador. Debes configurar las credenciales de la aplicación Meta en el Worker.</p><div class="connect-row"><input v-model="metaToken" type="password" autocomplete="off" placeholder="Access token de Meta"><button class="primary" :disabled="!metaConfigured" @click="connectMeta">Conectar y sincronizar</button></div><div v-if="metaMessage" class="notice">{{ metaMessage }}</div></div><div v-if="metaAccounts.length" class="account-list"><strong>Cuentas conectadas</strong><div v-for="account in metaAccounts" :key="account.id" class="account-row"><span class="avatar small">{{ account.name.charAt(0).toUpperCase() }}</span><div><strong>{{ account.name }}</strong><small>Cuenta Meta conectada</small></div></div></div><div class="panel-subhead"><h3>Páginas y destinos disponibles</h3><button @click="loadDestinations">Actualizar</button></div><div v-if="destinations.length" class="destination-list"><div v-for="destination in destinations" :key="destination.id" class="destination-row"><div><span class="destination-icon">◎</span><div><strong>{{ destination.name }}</strong><small>{{ destination.type === 'page' ? 'Página de Facebook' : destination.type }} · {{ destination.provider_id }}</small></div></div><button class="danger" @click="removeDestination(destination)">Desconectar</button></div></div><div v-else class="empty"><div class="empty-icon">◎</div><h3>No hay destinos conectados</h3><p>Conecta Meta para sincronizar los destinos disponibles.</p></div></div></section>
      <section v-else class="content"><div class="panel placeholder"><div class="empty"><div class="empty-icon">✦</div><h2>Calendario</h2><p>El calendario visual será el siguiente módulo. La programación ya está disponible desde el editor.</p><button class="secondary" @click="view = 'posts'">Ir a publicaciones</button></div></div></section>
    </main>
  </div>
</template>
