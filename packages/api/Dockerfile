# Build: bundle the API with the core code of the workspace.
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter "@legal-lint/api..."
RUN pnpm --filter @legal-lint/api build

# Run: Node, the two packages that are not in the bundle, and only the headless shell of Chromium (a smaller image).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install --omit=dev --no-save --no-package-lock playwright@1.63.0 @google-cloud/firestore@9.3.1 \
  && npx playwright install --with-deps --only-shell chromium \
  && rm -rf /root/.npm /var/lib/apt/lists/*
COPY --from=build /src/packages/api/dist ./dist
COPY packages/api/package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
