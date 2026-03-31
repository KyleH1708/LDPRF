# Real-Time Collaboration Setup Guide

Your app is now configured to support real-time collaboration! Multiple users can now view and edit tracks simultaneously. Here's how to set it up:

## Step 1: Create a Supabase Account

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Sign Up" and create an account
3. Create a new project (choose a region close to you)
4. Wait for the project to be ready

## Step 2: Create the Database Table

Once your Supabase project is ready:

1. Go to the SQL Editor in your Supabase dashboard
2. Click "New Query"
3. Paste the following SQL and run it:

```sql
-- Create tracks table
CREATE TABLE tracks (
  id BIGSERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  classification VARCHAR(20) NOT NULL,
  height INTEGER NOT NULL,
  speedKmh REAL NOT NULL,
  heading REAL NOT NULL,
  bearing REAL NOT NULL,
  rangeKm REAL NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  history JSONB DEFAULT '[]',
  remarks TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Enable Row Level Security for real-time
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows anyone to read/write tracks
CREATE POLICY "Allow all access" ON tracks
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable real-time for the tracks table
ALTER PUBLICATION supabase_realtime ADD TABLE tracks;
```

## Step 3: Get Your Credentials

1. In Supabase, go to **Settings > API**
2. Copy these values:
   - **Project URL** - this goes in `VITE_SUPABASE_URL`
   - **Anon Key** - this goes in `VITE_SUPABASE_ANON_KEY`

3. Edit `.env.local` in your project and replace the placeholder values:

```
VITE_SUPABASE_URL=https://your-project-reference.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Step 4: Test It Out

1. Make sure your app is running (`npm run dev`)
2. Open the app in multiple browser tabs
3. Add a track in one tab
4. You should see it appear in the other tabs automatically!
5. Changes to tracks will sync in real-time across all browsers

## Deployment on Vercel

When you deploy on Vercel:

1. Go to your Vercel project settings
2. Navigate to **Environment Variables**
3. Add both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. Redeploy

That's it! Your app will now support real-time collaboration for all users!

## How It Works

- When you add, update, or delete a track, it's automatically saved to the Supabase database
- All connected users receive real-time updates via WebSocket subscriptions
- Track position updates (from automatic movement) are synced every second
- The app works offline too - if Supabase isn't configured, it falls back to local state

## Troubleshooting

**Tracks not syncing?**
- Check that your `.env.local` file has the correct Supabase URLs and keys
- Open browser DevTools console to see any error messages
- Make sure the `tracks` table exists in your Supabase project

**Can't see other users' tracks?**
- Refresh the page
- Make sure all users are on the same Supabase project
- Check that Row Level Security policies are correctly set up
