// Authenticated school responses are never cached by this worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>School is offline</title><body style="font-family:system-ui;padding:40px"><h1>Your school host is offline.</h1><p>Reconnect to your private network and reload. Your saved notes remain on the host.</p></body>',{headers:{'Content-Type':'text/html'}})));
});
