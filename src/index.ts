/** Entrypoint: load env config, open the ndjson store, serve the relay. */
import { loadConfig } from './config.js';
import { createRelayServer } from './server.js';
import { EventStore } from './store.js';

const config = loadConfig();
const store = await EventStore.open(config.storeDir);
const server = createRelayServer({
  store,
  ...(config.token !== undefined ? { token: config.token } : {}),
  maxBodyBytes: config.maxBodyBytes,
});

server.listen(config.port, () => {
  console.log(
    `memorize_hub relay listening on :${config.port} ` +
      `(store=${config.storeDir}, auth=${config.token ? 'bearer' : 'open'})`,
  );
});
