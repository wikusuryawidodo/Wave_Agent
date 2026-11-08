FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY fixtures ./fixtures
COPY .env.example ./.env.example
USER node
CMD ["node","src/worker.js"]
