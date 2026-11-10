upstream alo_nextjs {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ __KIT_DOMAIN__;
    root __KIT_NGINX_WEBROOT__;
    index index.html;
    include /etc/nginx/snippets/alo-security.conf;
    include /etc/nginx/snippets/alo-litellm.conf;
    include /etc/nginx/snippets/alo-netdata.conf;
    include /etc/nginx/snippets/alo-syncthing.conf;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { try_files $uri $uri/ =404; }
    location @nextjs {
        proxy_pass http://alo_nextjs;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
