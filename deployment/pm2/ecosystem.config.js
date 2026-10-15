// PM2 process definition for the 3xCode backend.
// Usage: pm2 start deployment/pm2/ecosystem.config.js --env production
//        pm2 save
//
// The API also serves the built SPA in production, but Nginx handles static
// assets directly (see deployment/nginx/3xcode.conf) for performance.

const path = require('path');

const root = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      name: '3xcode-backend',
      script: path.join(root, 'backend/dist/server.js'),
      cwd: path.join(root, 'backend'),
      // A single instance: sequential document numbering and the in-process
      // scheduler are deliberately not multi-process safe.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      kill_timeout: 12_000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Logs land in ~/.pm2/logs on the server.
      error_file: path.join(root, 'logs/3xcode-backend-error.log'),
      out_file: path.join(root, 'logs/3xcode-backend-out.log'),
      merge_logs: true,
    },
  ],
};
