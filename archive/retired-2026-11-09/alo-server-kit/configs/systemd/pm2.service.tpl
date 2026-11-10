[Unit]
Description=PM2 process manager for __KIT_PRIMARY_USER__
After=network.target
[Service]
Type=forking
User=__KIT_PRIMARY_USER__
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=PM2_HOME=/home/__KIT_PRIMARY_USER/.pm2
ExecStart=/usr/local/bin/pm2 resurrect
ExecStop=/usr/local/bin/pm2 kill
ExecReload=/usr/local/bin/pm2 reload all
Restart=on-failure
[Install]
WantedBy=multi-user.target
