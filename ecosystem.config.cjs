module.exports = {
  apps: [
    {
      name: "wb-expert-listener",
      script: "dist/index.js",
      cwd: __dirname + "/..",
      instances: 1,            // 单实例（SQLite + 会话池本地态，勿多开）
      exec_mode: "fork",
      autorestart: true,       // 崩溃自动重启（SC12）
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "logs/pm2-err.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
