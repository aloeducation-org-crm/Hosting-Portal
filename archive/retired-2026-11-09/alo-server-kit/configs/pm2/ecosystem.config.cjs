module.exports = {
  apps: [{
    name: 'alo-nextjs',
    script: './.next/standalone/server.js',
    instances: 2,
    exec_mode: 'cluster',
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production', PORT: 3000, HOST: '127.0.0.1' },
    error_file: '/home/alamin/.pm2/logs/alo-nextjs-err.log',
    out_file:   '/home/alamin/.pm2/logs/alo-nextjs-out.log',
    time: true
  }]
};
