import { getDb } from '../../lib/db.js';
import { verifyPassword, createToken, sessionCookie } from '../../lib/auth.js';

export const config = { runtime: 'edge' };

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export default async function handler(req) {
  // Only POST is allowed
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed' },
      405,
      { Allow: 'POST' }
    );
  }

  // Read JSON request body
  let body;

  try {
    body = await req.json();
  } catch (error) {
    console.error('Invalid login JSON:', error);
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body?.email || '')
    .trim()
    .toLowerCase();

  const password = String(body?.password || '');

  if (!email || !password) {
    return jsonResponse(
      { error: 'Email and password are required' },
      400
    );
  }

  try {
    // Connect to Neon
    const sql = getDb();

    // Find user
    const rows = await sql`
      SELECT
        id,
        email,
        password_hash,
        name,
        role
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;

    const user = rows[0];

    // Don't reveal whether email exists
    if (!user) {
      return jsonResponse(
        { error: 'Invalid email or password' },
        401
      );
    }

    // Check password
    const passwordValid = await verifyPassword(
      password,
      user.password_hash
    );

    if (!passwordValid) {
      return jsonResponse(
        { error: 'Invalid email or password' },
        401
      );
    }

    // Update last login
    await sql`
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = ${user.id}
    `;

    // Create JWT
    const token = await createToken(user);

    // Return successful login
    return jsonResponse(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      },
      200,
      {
        'Set-Cookie': sessionCookie(token)
      }
    );

  } catch (error) {
    console.error('LOGIN ERROR:', error);

    const message = String(
      error?.message || error || 'Unknown server error'
    );

    // Database configuration
    if (
      /DATABASE_URL|database is not configured|not set/i.test(message)
    ) {
      return jsonResponse(
        {
          error:
            'Database is not configured. Check DATABASE_URL in Vercel.'
        },
        500
      );
    }

    // Missing users table
    if (
      /relation .*users.*does not exist|users.*does not exist/i.test(
        message
      )
    ) {
      return jsonResponse(
        {
          error:
            'The users table does not exist in the database.'
        },
        500
      );
    }

    // Incorrect database schema
    if (
      /column .*password_hash.*does not exist|column .*role.*does not exist|column .*last_login_at.*does not exist/i.test(
        message
      )
    ) {
      return jsonResponse(
        {
          error:
            'The users table schema is outdated. Run the latest schema.sql in Neon.'
        },
        500
      );
    }

    // JWT secret
    if (/JWT_SECRET/i.test(message)) {
      return jsonResponse(
        {
          error:
            'JWT_SECRET is missing or invalid in Vercel.'
        },
        500
      );
    }

    // Password/bcrypt error
    if (/bcrypt|password_hash/i.test(message)) {
      return jsonResponse(
        {
          error:
            'Password verification failed. Check the stored password hash.'
        },
        500
      );
    }

    return jsonResponse(
      {
        error: 'Login server error.',
        details: message
      },
      500
    );
  }
}
