# spotify-downloader

To install dependencies:

```bash
bun install
```

## Getting Your Liked Songs Data

Before running the application, you need to export your Spotify liked songs:

1. Go to [https://exportify.net/](https://exportify.net/)
2. Connect your Spotify account
3. Export your liked songs
4. Make sure the file is named exactly `Liked_Songs.csv` (case-sensitive)

Place the `Liked_Songs.csv` file in the project root directory.

To run:

```bash
bun run src/index.ts
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
