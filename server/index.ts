

import { app } from './app';
import { env } from './config/env';

const server = app.listen(env.PORT, () => {
  console.log(`biz2code API on http://localhost:${env.PORT}`);
});


server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${env.PORT} is already in use.\n` +
      '  Another "npm run dev" or a checkpoint script is probably still running.\n' +
      '  Stop it, or set PORT in .env — but note that client/vite.config.ts\n' +
      `  proxies /api to ${env.PORT}, so both have to move together.\n`,
    );
    process.exit(1);
  }
  throw err;
});
