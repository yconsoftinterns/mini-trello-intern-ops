# Railway deployment

This project is prepared to run on Railway as a single Node/Express service with SQLite stored on a Railway Volume.

## Railway settings

- Build: automatic Railpack detection
- Start command: `npm start`
- Healthcheck path: `/api/health`
- Attach a Railway Volume to the service at: `/app/data`
- Set `NODE_ENV=production`
- Set `ADMIN_USERNAME`
- Set `ADMIN_PASSWORD`
- Set `OPENAI_API_KEY`
- Optional: set `OPENAI_MODEL` (defaults to `gpt-5`)

The server automatically uses `RAILWAY_VOLUME_MOUNT_PATH` when Railway provides it, so the SQLite database persists on the attached volume.

## GitHub

Do not commit `.env`, API keys, or `*.db` files. Commit `.env.example` only.

## Important security note

If an API key was ever committed to GitHub or shared publicly, revoke/rotate it and create a new key. Keep the replacement only in Railway Variables.

## First deployment

1. Push this folder to a GitHub repository.
2. In Railway, create a new project and deploy from the GitHub repository.
3. Set the variables listed above.
4. Attach a Volume mounted at `/app/data`.
5. Set Deploy -> Healthcheck Path to `/api/health`.
6. Generate a public domain under Settings -> Networking.
7. Open the generated HTTPS URL and sign in with the admin credentials you configured.

## Data note

SQLite + a Railway Volume is appropriate for this single-service app and avoids data disappearing on redeploy. Keep the service at one active replica. If the application later needs horizontal scaling or heavier concurrent usage, migrate the database layer to Railway PostgreSQL.
