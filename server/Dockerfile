FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY src ./src
COPY package.json ./package.json

VOLUME ["/app/data"]
EXPOSE 8787

CMD ["node", "src/index.js"]
