// Reporter notification (BUILD_SPEC §17).
// PUSH_MODE=poll (default): no push library; the PWA service worker polls /v1/reports/:rid/status.
// PUSH_MODE=webpush: `web-push` (MPL-2.0, licence pending confirmation) loaded lazily.

export async function createPusher(config, log = console) {
  if (config.pushMode !== 'webpush') {
    return { mode: 'poll', async send() { return { ok: false, skipped: 'poll' }; } };
  }
  if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject) {
    throw new Error('PUSH_MODE=webpush requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT');
  }
  const mod = await import('web-push');
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);

  return {
    mode: 'webpush',
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
        return { ok: true };
      } catch (err) {
        // Never log the subscription endpoint/keys.
        log.warn?.({ statusCode: err?.statusCode }, 'web push failed');
        return { ok: false, gone: err?.statusCode === 404 || err?.statusCode === 410 };
      }
    },
  };
}
