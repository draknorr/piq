FROM node:22-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @publisheriq/shared build
RUN pnpm --filter @publisheriq/data-plane build
RUN pnpm --filter @publisheriq/query-api build
RUN pnpm --filter @publisheriq/research-mcp build

ENV NODE_ENV=production

WORKDIR /app

EXPOSE 4318 4320

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const service = process.env.PUBLISHERIQ_SERVICE || 'query-api'; const port = process.env.PORT || (service === 'research-mcp' ? '4320' : '4318'); fetch('http://127.0.0.1:' + port + '/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["sh", "-c", "if [ \"$PUBLISHERIQ_SERVICE\" = \"research-mcp\" ]; then pnpm --filter @publisheriq/research-mcp start; else pnpm --filter @publisheriq/query-api start; fi"]
