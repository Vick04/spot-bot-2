import http from 'http';
import express from 'express';
import cors from 'cors';
import { BotManager } from './managers/BotManager';
import { createRouter } from './routes/api';
import { createSocketServer } from './services/socketServer';

const PORT = process.env.PORT ?? 3000;

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const bot = new BotManager();
  await bot.start();

  app.use('/api', createRouter(bot));

  const httpServer = http.createServer(app);
  createSocketServer(httpServer, bot.observerManager, bot.topSymbolsManager);

  httpServer.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });

  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    bot.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
