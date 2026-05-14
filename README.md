# Actualy - Time Tracking App

Time tracking that compares what you planned to do vs. what you actually did.

## Features

- 📅 Plan your day with scheduled events
- ⏱️ Track actual time spent on activities
- 📝 Add notes to your tracked sessions
- 📊 Export data to CSV/Google Sheets
- 🎨 Color-coded events
- 🔐 Google OAuth authentication

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth with Google OAuth
- **Frontend**: Vanilla JavaScript

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with:
   ```
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. Run the database schema in Supabase (see `schema.sql`)

4. Configure Google OAuth in Supabase (see `GOOGLE_OAUTH_SETUP.md`)

5. Start the server:
   ```bash
   npm start
   ```

6. Open http://localhost:3000

## Deployment

This app is configured for easy deployment on Render, Railway, Vercel, or Fly.io.

### Deploy to Render

1. Push your code to GitHub
2. Go to https://render.com and sign up
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Render will auto-detect the configuration from `render.yaml`
6. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
7. Click "Create Web Service"
8. Update Supabase OAuth redirect URL with your Render URL

## Environment Variables

- `PORT` - Server port (default: 3000)
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key

## API Endpoints

- `GET /health` - Health check
- `GET /auth/user` - Get current user
- `GET /api/events/today` - Get today's events
- `POST /api/events` - Create event
- `PATCH /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event
- `GET /api/sessions/today` - Get today's sessions
- `POST /api/sessions` - Create session
- `PATCH /api/sessions/:id/notes` - Update session notes
- `GET /api/export` - Export all data as CSV

## License

MIT
