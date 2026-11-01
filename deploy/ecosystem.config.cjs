// pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
// paths are relative to this repo, so it works from /root/cfp_erp, /var/www/cpf-erp or anywhere
const path = require('path');
const BACKEND = path.resolve(__dirname, '../backend');
module.exports = {
  apps: [
    {
      name: 'cpf-api',
      cwd: BACKEND,
      script: 'src/server.js',
      exec_mode: 'cluster',
      instances: 2,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
      out_file: '/var/log/cpf/api.out.log',
      error_file: '/var/log/cpf/api.err.log',
      time: true,
    },
    {
      name: 'cpf-worker',
      cwd: BACKEND,
      script: 'src/jobs/worker.js',
      exec_mode: 'fork',
      instances: 1, // exactly one: owns repeatable daily jobs
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
      out_file: '/var/log/cpf/worker.out.log',
      error_file: '/var/log/cpf/worker.err.log',
      time: true,
    },
  ],
};
