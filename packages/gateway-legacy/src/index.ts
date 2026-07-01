import { loadGatewayConfig } from './config.js';
import { openGatewayDb } from './db.js';
import { createGatewayServer } from './server.js';

const config = loadGatewayConfig();
const db = openGatewayDb(config.dbFile);
const server = createGatewayServer({ db, config });

server.listen(config.port, () => {
  const auth = config.relayToken ? 'with relay token' : 'NO relay token (dev/open relay)';
  console.log(
    `memorize Hub gateway listening on :${config.port} → relay ${config.relayUrl} (${auth}); db ${config.dbFile}`,
  );
  if (!config.relayToken) {
    console.warn(
      'warning: RELAY_INTERNAL_TOKEN is unset — the gateway will call the relay unauthenticated. Set it in production.',
    );
  }
});
