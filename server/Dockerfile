FROM rust:1-trixie AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY server/Cargo.toml server/Cargo.lock ./server/
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY crates/access-kit ./crates/access-kit
RUN cargo build --manifest-path server/Cargo.toml --release --locked

FROM debian:trixie-slim
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin app && mkdir -p /app/data && chown app /app/data
WORKDIR /app
COPY --from=build /build/server/target/release/es-keyword-query-server /usr/local/bin/es-keyword-query-server
COPY server/web /app/web
ENV ES_SERVER_BIND=0.0.0.0:8670 ES_SERVER_DATA_DIR=/app/data ES_SERVER_STATIC_DIR=/app/web
VOLUME /app/data
EXPOSE 8670
USER app
CMD ["es-keyword-query-server"]
