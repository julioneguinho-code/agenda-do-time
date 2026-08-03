// Service Worker — base para notificações push (ativa de verdade na publicação, com HTTPS + chaves VAPID).
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Recebe o push do servidor (quando o app estiver publicado com Web Push configurado)
self.addEventListener('push', e => {
  let dados = { titulo: 'Agenda do Time', texto: 'Você tem uma nova notificação' };
  try { if (e.data) dados = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(dados.titulo, {
    body: dados.texto,
    icon: '/public/icon.png',
    badge: '/public/icon.png',
    tag: dados.tag || 'agenda',
  }));
});

// Ao clicar na notificação, abre/foca o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  }));
});
