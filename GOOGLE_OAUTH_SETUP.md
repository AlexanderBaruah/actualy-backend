# Setting up Google OAuth with Supabase

Follow these steps to enable Google OAuth login for Actualy:

## 1. Enable Google OAuth in Supabase

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/kodxtnmprtlbsafxizrw
2. Click **Authentication** in the left sidebar
3. Click **Providers** tab
4. Find **Google** and toggle it ON
5. Copy the **Callback URL** shown (it will look like: `https://kodxtnmprtlbsafxizrw.supabase.co/auth/v1/callback`)

## 2. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Go to **APIs & Services** → **Credentials**
4. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
5. If prompted, configure the OAuth consent screen first:
   - Choose **External** user type
   - Fill in app name: "Actualy"
   - Add your email as support email
   - Skip optional fields and save
6. Back to creating OAuth client ID:
   - Application type: **Web application**
   - Name: "Actualy Web Client"
   - Authorized redirect URIs: Paste the Supabase callback URL from step 1
   - Click **Create**
7. Copy the **Client ID** and **Client Secret**

## 3. Add Google Credentials to Supabase

1. Back in Supabase Authentication > Providers > Google
2. Paste your **Client ID**
3. Paste your **Client Secret**
4. Click **Save**

## 4. How it works in your app

Your frontend will use the Supabase JavaScript client to trigger Google login:

```javascript
// In your frontend HTML
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'http://localhost:3000' // or your production URL
  }
})
```

After successful login, Supabase will return a session with an access token. Your frontend stores this token and includes it in API requests:

```javascript
// In API calls
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token

// Include in requests to your backend
fetch('http://localhost:3000/api/events', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
```

Your backend will verify this token using the middleware we created!
