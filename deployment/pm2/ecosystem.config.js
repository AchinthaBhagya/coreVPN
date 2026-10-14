module.exports = {
  apps: [
    {
      name: '3xcode-backend',
      script: './backend/dist/server.js',
      cwd: '/var/www/3xcode-management',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
