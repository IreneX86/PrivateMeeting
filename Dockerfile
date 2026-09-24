FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.server.json ./
COPY server ./server
COPY shared ./shared
RUN npm run build:server && npm prune --omit=dev
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8787
CMD ["npm", "start"]
