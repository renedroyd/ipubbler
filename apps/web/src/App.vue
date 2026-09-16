<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type Post, type User } from './api'

const user = ref<User | null>(null)
const loading = ref(true)
const loginError = ref('')
const email = ref('')
const password = ref('')
const content = ref('')
const scheduledAt = ref('')
const posts = ref<Post[]>([])
const stats = ref({ scheduled: 0, published: 0, draft: 0, failed: 0, processing: 0 })
const view = ref('dashboard')
const menu = [{ id: 'dashboard', label: 'Dashboard', icon: '⌂' }, { id: 'posts', label: 'Publicaciones', icon: '▣' }, { id: 'calendar', label: 'Calendario', icon: '□' }, { id: 'media', label: 'Multimedia', icon: '◈' }, { id: 'history', label: 'Historial', icon: '↺' }]

async function loadData() {
  const me = await api.me(); user.value = me.user
  if (!user.value) return
  const [postData, statData] = await Promise.all([api.posts(), api.stats()])
  posts.value = postData.posts; stats.value = statData.stats as typeof stats.value
}
async function login() {
  loginError.value = ''; loading.value = true
  try { await api.login(email.value, password.value); await loadData() }
  catch (e) { loginError.value = e instanceof Error ? e.message : 'No fue posible iniciar sesión' }
  finally { loading.value = false }
}
async function logout() { await api.logout(); user.value = null }
async function savePost() {
  try { await api.createPost(content.value, scheduledAt.value ? new Date(scheduledAt.value).toISOString() : null, Intl.DateTimeFormat().resolvedOptions().timeZone); content.value = ''; scheduledAt.value = ''; await loadData() }
  catch (e) { alert(e instanceof Error ? e.message : 'No fue posible guardar') }
}
async function removePost(id: string) { if (!confirm('¿Eliminar esta publicación?')) return; await api.deletePost(id); await loadData() }
onMounted(async () => { try { await loadData() } catch { user.value = null } finally { loading.value = false } })
</script>

<template>
  <div v-if="loading" class="loading-screen">Cargando ipubbler…</div>
  <div v-else-if="!user" class="login-screen"><form class="login-card" @submit.prevent="login"><div class="brand large"><span class="brand-mark">i</span><span>ipubbler</span></div><h1>Iniciar sesión</h1><p>Administra tus publicaciones desde un solo lugar.</p><label>Email<input v-model="email" type="email" autocomplete="email" required></label><label>Contraseña<input v-model="password" type="password" autocomplete="current-password" required></label><div v-if="loginError" class="error">{{ loginError }}</div><button class="primary full" :disabled="loading">Entrar</button></form></div>
  <div v-else class="app-shell">
    <aside class="sidebar"><div class="brand"><span class="brand-mark">i</span><span>ipubbler</span></div><nav><button v-for="item in menu" :key="item.id" :class="['nav-item', { active: view === item.id }]" @click="view = item.id"><span>{{ item.icon }}</span>{{ item.label }}</button></nav><div class="sidebar-footer"><strong>{{ user.name }}</strong><button @click="logout">Cerrar sesión</button></div></aside>
    <main class="main"><header class="topbar"><div><p class="eyebrow">PUBLICADOR SOCIAL</p><h1>{{ menu.find(m => m.id === view)?.label }}</h1></div><button class="avatar">{{ user.name.charAt(0).toUpperCase() }}</button></header>
      <section v-if="view === 'dashboard'" class="content"><div class="welcome"><div><h2>Tu centro de publicaciones</h2><p>Planifica y administra tu contenido desde un solo lugar.</p></div><button class="primary" @click="view = 'posts'">+ Nueva publicación</button></div><div class="stats"><article><span>Programadas</span><strong>{{ stats.scheduled }}</strong><small>pendientes</small></article><article><span>Publicadas</span><strong>{{ stats.published }}</strong><small>publicadas</small></article><article><span>Borradores</span><strong>{{ stats.draft }}</strong><small>para continuar</small></article><article><span>Fallidas</span><strong>{{ stats.failed }}</strong><small>requieren atención</small></article></div><div class="panel"><div class="panel-head"><h3>Próximas publicaciones</h3><button @click="view = 'posts'">Ver publicaciones →</button></div><div v-if="posts.filter(p => p.status === 'scheduled').length" class="post-list"><div v-for="post in posts.filter(p => p.status === 'scheduled').slice(0, 5)" :key="post.id" class="post-row"><div><strong>{{ new Date(post.scheduled_at!).toLocaleString() }}</strong><p>{{ post.content }}</p></div><span class="badge scheduled">programada</span></div></div><div v-else class="empty"><div class="empty-icon">✦</div><h3>Aún no hay publicaciones programadas</h3><p>Crea tu primera publicación y prográmala para una fecha y hora.</p><button class="secondary" @click="view = 'posts'">Crear publicación</button></div></div></section>
      <section v-else-if="view === 'posts'" class="content"><div class="panel composer"><div class="panel-head"><h2>Nueva publicación</h2><span>Fase 1</span></div><textarea v-model="content" maxlength="5000" placeholder="¿Qué quieres publicar?"></textarea><div class="composer-footer"><label>Fecha y hora (opcional)<input v-model="scheduledAt" type="datetime-local"></label><button class="primary" @click="savePost">{{ scheduledAt ? 'Programar' : 'Guardar borrador' }}</button></div></div><div class="panel"><div class="panel-head"><h3>Mis publicaciones</h3></div><div v-if="posts.length" class="post-list"><div v-for="post in posts" :key="post.id" class="post-row"><div><span :class="['badge', post.status]">{{ post.status }}</span><p>{{ post.content }}</p><small v-if="post.scheduled_at">{{ new Date(post.scheduled_at).toLocaleString() }}</small></div><button class="danger" @click="removePost(post.id)">Eliminar</button></div></div><div v-else class="empty"><p>No tienes publicaciones todavía.</p></div></div></section>
      <section v-else class="content"><div class="panel placeholder"><div class="empty"><div class="empty-icon">✦</div><h2>{{ menu.find(m => m.id === view)?.label }}</h2><p>Este módulo queda preparado para la siguiente iteración de la Fase 1.</p></div></div></section>
    </main>
  </div>
</template>
