FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server.js store.js tickets.js identity.js ./
COPY public ./public

EXPOSE 3000

CMD ["node", "--experimental-sqlite", "server.js"]
