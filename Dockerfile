# syntax=docker/dockerfile:1.7

# =============================================================================
# Codex Trace — Docker image
#
# Runs the Rust/axum backend in headless mode. The frontend is published
# independently as a single HTML file and downloaded when the container starts.
#
# Build:
#   docker build -t codex-trace .
#
# Run (mount your Codex home read-only so session_index.jsonl is available):
#   docker run --rm -p 1422:1422 \
#     -v "$HOME/.codex:/home/app/.codex:ro" \
#     codex-trace
#
# Then open http://localhost:1422 in a browser.
#
# Configurable env vars:
#   CODEXTRACE_HTTP_HOST     bind host      (default: 0.0.0.0 in this image)
#   CODEXTRACE_HTTP_PORT     bind port      (default: 1422 in this image)
#   CODEXTRACE_STATIC_DIR    downloaded UI  (default: /app/dist in this image)
#   CODEXTRACE_FRONTEND_URL  single HTML URL (default: frontend-latest release)
#   CODEXTRACE_FRONTEND_PROXY optional HTTP(S) proxy for frontend downloads
# =============================================================================

ARG RUST_IMAGE=rust:latest

# -----------------------------------------------------------------------------
# Stage 1 — build the Rust backend
# -----------------------------------------------------------------------------
FROM ${RUST_IMAGE} AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        libwebkit2gtk-4.1-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxdo-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# The workspace root plus both members are needed: src-tauri depends on the
# parser crate by path, and Cargo resolves the workspace from the root manifest.
# The shared lockfile also lives at the root now.
COPY Cargo.toml ./Cargo.toml
COPY Cargo.lock ./Cargo.lock
COPY parser ./parser
COPY src-tauri ./src-tauri

WORKDIR /build/src-tauri
# Fat LTO (lto=true in Cargo.toml) loads all program bitcode at once and OOMs
# in memory-constrained Docker builds. Thin LTO delivers most of the same
# optimisation while keeping peak RSS under control.
RUN CARGO_PROFILE_RELEASE_LTO=thin cargo build --release --locked --jobs 2 --bin codex-trace

# -----------------------------------------------------------------------------
# Stage 2 — runtime image
# -----------------------------------------------------------------------------
FROM debian:trixie-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-0 \
        libayatana-appindicator3-1 \
        librsvg2-2 \
        libxdo3 \
        xvfb \
        xauth \
        dumb-init \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --home-dir /home/app --shell /bin/bash --uid 1000 app \
    && install -d -o app -g app /app/dist

WORKDIR /app

# Cargo builds a workspace into the target directory of the workspace root
# (`/build/target`), not into a member's directory, so the binary is not under
# src-tauri/ any more.
COPY --from=backend-builder /build/target/release/codex-trace /usr/local/bin/codex-trace
COPY script/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV CODEXTRACE_HTTP_HOST=0.0.0.0 \
    CODEXTRACE_HTTP_PORT=1422 \
    CODEXTRACE_STATIC_DIR=/app/dist \
    CODEXTRACE_FRONTEND_URL=https://github.com/starofkuku/codex-trace/releases/download/frontend-latest/codex-trace-frontend.html \
    CODEXTRACE_FRONTEND_PROXY= \
    XDG_CONFIG_HOME=/home/app/.config \
    XDG_DATA_HOME=/home/app/.local/share

USER app

VOLUME ["/home/app/.codex"]

EXPOSE 1422

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${CODEXTRACE_HTTP_PORT:-1422}"]

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["codex-trace", "--headless"]
