// Service Worker do Gestão Chama (servido em /sw.js, controla o site todo).
// - Notificações PUSH: chegam mesmo com o app fechado (o servidor manda via Web Push/VAPID).
// - Não faz cache das telas/dados: tudo continua sempre atualizado (evita mostrar informação velha).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = { titulo: 'Gestão Chama', texto: 'Você tem uma nova notificação', url: '/' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.titulo, {
    body: d.texto,
    icon: '/public/icon-192.png',
    badge: '/public/favicon-64.png',
    tag: d.tag || 'chama',
    data: { url: d.url || '/' },
  }));
});

// Ao tocar na notificação: foca o app se já estiver aberto, senão abre na tela certa
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { c.postMessage({ tipo: 'push-click' }); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
