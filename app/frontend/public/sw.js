// Solo para los avisos al móvil: no guarda nada ni intercepta peticiones.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { /* sin contenido */ }
  e.waitUntil(self.registration.showNotification(d.titulo || "Tienda", {
    body: d.cuerpo || "",
    icon: "/icono-192.png",
    badge: "/icono-192.png",
    tag: "aviso-diario",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data.url;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
    const abierta = ventanas[0];
    // navigate() falla si esa pestaña se abrió antes de activar los avisos
    if (abierta) return abierta.navigate(url).then((v) => (v || abierta).focus()).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
