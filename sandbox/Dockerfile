# memorize replica for the convergence sandbox — a single "machine".
# Plain published client; better-sqlite3's linux binary is fetched on install.
FROM node:24-bookworm-slim
ENV MEMORIZE_LLM_BACKEND=off
RUN npm install -g @shakystar/memorize@2.4.0
WORKDIR /work
CMD ["sleep", "infinity"]
