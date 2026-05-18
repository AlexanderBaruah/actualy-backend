const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

/**
 * Middleware to verify JWT token from Supabase Auth
 * Extracts the user and creates a user-specific Supabase client
 */
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    console.log('[Auth] Headers:', JSON.stringify(req.headers, null, 2));

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[Auth] Missing or invalid authorization header');
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    console.log('[Auth] Token received:', token.substring(0, 20) + '...');

    // Create a Supabase client with the user's token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    // Verify the token
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('[Auth] Supabase auth error:', error);
      return res.status(401).json({ error: 'Invalid or expired token', details: error.message });
    }

    if (!user) {
      console.error('[Auth] No user returned from Supabase');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    console.log('[Auth] User authenticated:', user.id);

    // Attach user and user-specific supabase client to request
    req.user = user;
    req.supabase = supabase;
    next();
  } catch (error) {
    console.error('[Auth] Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed', details: error.message });
  }
}

module.exports = { authenticateUser };
