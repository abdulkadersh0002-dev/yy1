# Build stage: compile the React/Vite dashboard
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . ./

ARG VITE_API_BASE_URL=
ARG VITE_API_KEY=
ARG VITE_WS_URL=
ARG VITE_WS_PATH=/ws/trading

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_KEY=${VITE_API_KEY}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_WS_PATH=${VITE_WS_PATH}

RUN npm run build

# Runtime stage: serve static assets with Nginx
FROM nginx:1.27-alpine AS runner

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
