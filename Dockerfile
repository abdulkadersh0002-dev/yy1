FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts

COPY . ./

ENV NODE_ENV=production
ENV PORT=4101
ENV ALLOW_SYNTHETIC_DATA=false
ENV REQUIRE_REALTIME_DATA=true

EXPOSE 4101

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4101/api/healthz || exit 1

CMD ["npm", "start"]
