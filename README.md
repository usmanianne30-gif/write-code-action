# Write Code Action

## Run locally

1. Copy `.env.example` to `.env` and set a strong `PASSWORD_UNIQUENESS_KEY`.
2. For global registrations, create a free Supabase project, run `supabase-schema.sql` in its SQL Editor, then add its URL and server-only service-role key to `.env`.
3. In this folder run `npm start`.
4. Open `http://localhost:4173`.

## Public deployment

This project includes `render.yaml` for Render's free web service. In Render's Blueprint flow, provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the free Supabase project. Render generates `PASSWORD_UNIQUENESS_KEY` automatically. Supabase holds all permanent member data, so Render can safely restart or spin down without losing registrations.

GitHub Pages alone cannot run the sign-up API. Push this repository to GitHub and deploy it to a Node hosting provider to make registration global.
