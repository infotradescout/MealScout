self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "MealScout", body: "You have a new notification." };
  }

  const title = payload.title || "MealScout";
  const options = {
    body: payload.body || "You have a new notification.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: {
      url: payload.url || "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = (event.notification && event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(destination);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(destination);
        }
      }),
  );
});
