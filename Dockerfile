FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY gateway.mjs ./
USER node
ENV LISTEN_HOST=0.0.0.0
EXPOSE 8081
CMD ["node","gateway.mjs"]
