FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY test ./test
RUN chown -R node:node /app

USER node
EXPOSE 8080
CMD ["npm", "start"]
