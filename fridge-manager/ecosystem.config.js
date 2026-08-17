/**
 * PM2: запуск из корня fridge-manager с правильным cwd и .env
 *   pm2 start ecosystem.config.js
 *   pm2 restart fridge-manager
 *
 * Автоподнятие: autorestart + pm2 startup + scripts/watchdog-health.sh (cron)
 */
module.exports = {
  apps: [
    {
      name: 'fridge-manager',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 200,
      max_memory_restart: '900M',
      kill_timeout: 8000,
      listen_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
