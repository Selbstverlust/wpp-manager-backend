# Back-end (NestJS)

## Prerequisites
- Node.js 20+
- npm

## Setup
```bash
npm install
npm run start:dev
```

App runs on http://localhost:4000. Health: http://localhost:4000/health

## Build
```bash
npm run build
npm start
```

## Docker
Build and run via Docker Compose from repo root:
```bash
docker compose up -d --build backend
```

## Environment
Copy `.env.example` to `.env` if needed. `PORT` defaults to 4000.
