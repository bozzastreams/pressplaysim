import { startServer } from '../dist-server/index.js';
import { fileURLToPath } from 'node:url';
const service = await startServer({dev:false,staticDir:fileURLToPath(new URL('../dist/', import.meta.url))});
let closing=false;
async function stop(){if(closing)return;closing=true;await service.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
