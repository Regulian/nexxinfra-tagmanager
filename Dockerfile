FROM nginx:alpine

# Copiar arquivos para o nginx
COPY tracker.js /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expor porta 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
