<script setup lang="ts">
import { ref } from 'vue'

const view = ref('dashboard')
const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'posts', label: 'Publicaciones', icon: '▣' },
  { id: 'calendar', label: 'Calendario', icon: '□' },
  { id: 'media', label: 'Multimedia', icon: '◈' },
  { id: 'history', label: 'Historial', icon: '↺' },
]
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">i</span><span>ipubbler</span></div>
      <nav>
        <button v-for="item in menu" :key="item.id" :class="['nav-item', { active: view === item.id }]" @click="view = item.id">
          <span>{{ item.icon }}</span>{{ item.label }}
        </button>
      </nav>
      <div class="sidebar-footer">Fase 1 · MVP</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div><p class="eyebrow">PUBLICADOR SOCIAL</p><h1>{{ menu.find(m => m.id === view)?.label }}</h1></div>
        <button class="avatar">R</button>
      </header>

      <section v-if="view === 'dashboard'" class="content">
        <div class="welcome"><div><h2>Tu centro de publicaciones</h2><p>Planifica y administra tu contenido desde un solo lugar.</p></div><button class="primary" @click="view = 'posts'">+ Nueva publicación</button></div>
        <div class="stats">
          <article><span>Programadas</span><strong>0</strong><small>pendientes</small></article>
          <article><span>Publicadas</span><strong>0</strong><small>esta semana</small></article>
          <article><span>Borradores</span><strong>0</strong><small>para continuar</small></article>
          <article><span>Fallidas</span><strong>0</strong><small>requieren atención</small></article>
        </div>
        <div class="panel"><div class="panel-head"><h3>Próximas publicaciones</h3><button @click="view = 'calendar'">Ver calendario →</button></div><div class="empty"><div class="empty-icon">✦</div><h3>Aún no hay publicaciones</h3><p>Crea tu primera publicación y prográmala para una fecha y hora.</p><button class="secondary" @click="view = 'posts'">Crear publicación</button></div></div>
      </section>

      <section v-else class="content"><div class="panel placeholder"><div class="empty"><div class="empty-icon">✦</div><h2>{{ menu.find(m => m.id === view)?.label }}</h2><p>Este módulo forma parte de la Fase 1 y será conectado al API en los siguientes commits.</p></div></div></section>
    </main>
  </div>
</template>
