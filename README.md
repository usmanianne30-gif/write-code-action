# Write Code Action

## Run locally

1. Copy `.env.example` to `.env` and set a strong `PASSWORD_UNIQUENESS_KEY`.
2. In this folder run `npm start`.
3. Open `http://localhost:4173`.

## Public deployment

This project includes `render.yaml` for Render. Create a Blueprint from the GitHub repository, then approve the generated `PASSWORD_UNIQUENESS_KEY` and persistent 1 GB disk. The disk is required for `data/users.json`—without it, member records will be lost on restart. The included Render plan is `starter`, because persistent disks are not available on Render's free web service.

GitHub Pages alone cannot run the sign-up API. Push this repository to GitHub and deploy it to a Node hosting provider to make registration global.
