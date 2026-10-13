FROM nginxinc/nginx-unprivileged:1.30-alpine

# Drop the stock welcome pages so only the app is served
USER root
RUN rm -rf /usr/share/nginx/html/*
USER 101

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY icons /usr/share/nginx/html/icons
COPY fonts /usr/share/nginx/html/fonts

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
