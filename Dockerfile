# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# K 线图文字渲染需要字体（resvg 读系统字体）
RUN apk add --no-cache ttf-dejavu
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# 里程碑横幅的背景图（render/banner.ts 通过 import.meta.url 定位 ../../assets）
COPY assets ./assets
COPY package.json ./
USER node
# Railway 注入 PORT 时会启动 /health 端点；不注入也能跑（纯 polling worker）
CMD ["node", "dist/index.js"]
