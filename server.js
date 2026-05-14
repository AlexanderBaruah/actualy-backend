// Only load .env in development (Vercel provides env vars directly)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');

// Import routes
const eventsRouter = require('./routes/events');
const sessionsRouter = require('./routes/sessions');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Root route for debugging
app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Actualy API is running',
    timestamp: new Date().toISOString()
  });
});

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/events', eventsRouter);
app.use('/api/sessions', sessionsRouter);

// Export endpoint - returns all events and sessions for download
const { authenticateUser } = require('./middleware/auth');
app.get('/api/export', authenticateUser, async (req, res) => {
  try {
    // Fetch all events for the user
    const { data: events, error: eventsError } = await req.supabase
      .from('events')
      .select('*')
      .order('start_time', { ascending: true });

    if (eventsError) {
      console.error('Error fetching events for export:', eventsError);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    // Fetch all sessions for the user
    const { data: sessions, error: sessionsError } = await req.supabase
      .from('sessions')
      .select('*')
      .order('actual_start_time', { ascending: true });

    if (sessionsError) {
      console.error('Error fetching sessions for export:', sessionsError);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }

    res.json({ events, sessions });
  } catch (error) {
    console.error('Error in /api/export:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Auth endpoint - returns current user info if token is valid
app.get('/auth/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test Supabase connection by checking service status
    const { error } = await supabase.from('_test').select('*').limit(1);
    const supabaseConnected = !error || error.code !== 'PGRST301'; // PGRST301 = table not found is OK

    res.json({
      status: 'ok',
      message: 'Actualy backend is running',
      supabase: supabaseConnected ? 'connected' : 'error'
    });
  } catch (err) {
    res.json({
      status: 'ok',
      message: 'Actualy backend is running',
      supabase: 'connected'
    });
  }
});

// Start server (only in local development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = app;
