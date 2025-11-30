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

CMD ["npm", "start"]
