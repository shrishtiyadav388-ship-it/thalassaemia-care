// No fetch handler or offline cache: health-record responses are never cached here.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil((async()=>{
  // Ignore arbitrary remote copy. Always show the same discreet message.
  await self.registration.showNotification('Care reminder',{body:'You have a care reminder. Open your care space to check the details.',icon:'/favicon.svg',tag:typeof data.id==='string'?data.id:'care-reminder',renotify:false,data:{url:'/'}});
  if(typeof data.id==='string'&&typeof data.receipt==='string')await fetch('/api/push/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:data.id,receipt:data.receipt})}).catch(()=>{});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);if(existing)return existing.focus();return self.clients.openWindow('/');})());
});
