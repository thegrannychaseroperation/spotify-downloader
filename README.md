# striker

To install dependencies:

```bash
pnpm install
```

## Getting Your Liked Songs Data

Before running the application, you need to export your Spotify liked songs:

1. Go to [https://exportify.net/](https://exportify.net/)
2. Connect your Spotify account
3. Export your liked songs
4. Make sure the file is named exactly `Liked_Songs.csv` (case-sensitive)

## Run the web app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Run with Docker

```bash
docker compose up --build
```

The web app will be available at [http://localhost:3000](http://localhost:3000). The Postgres database is exposed on port 5432 with default credentials from `docker-compose.yml`.

If you want to run the app locally against the Docker database, set:

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/striker"
```
