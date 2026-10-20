// PM2 process file: keeps the server running and restarts it after a crash or reboot.
//   npm i -g pm2
//   pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'aeon',
      script: 'server/index.js',
      node_args: '--env-file-if-exists=.env',
      instances: 1, // one process: the indexer and SSE hub keep state in memory
      autorestart: true,
      max_memory_restart: '600M',
      restart_delay: 2000,
      kill_timeout: 5000, // time to flush the cache to disk on SIGTERM
      env: { NODE_ENV: 'production' },
    },
  ],
};
