/**
 * PM2: запуск из корня fridge-manager с правильным cwd и .env
 *   pm2 start ecosystem.config.js
 *   pm2 restart fridge-manager
 */
module.exports = {
  apps: [
    {
      name: 'fridge-manager',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 15,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
