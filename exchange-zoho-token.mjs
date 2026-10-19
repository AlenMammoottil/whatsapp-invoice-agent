
import fs from 'node:fs';
import readline from 'node:readline/promises';

const envText = fs.readFileSync('.env', 'utf8');

function getEnv(name) {
  const prefix = name + '=';
  const line = envText
    .split(/\r?\n/)
    .find(function (item) {
      return item.trim().startsWith(prefix);
    });

  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

const clientId = getEnv('ZOHO_CLIENT_ID');
const clientSecret = getEnv('ZOHO_CLIENT_SECRET');

if (!clientId || !clientSecret) {
  console.error('Missing ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET in .env');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

try {
  const code = (
    await rl.question('Paste your fresh Zoho authorization code: ')
  ).trim();

  if (!code) {
    throw new Error('Authorization code cannot be empty.');
  }

  const body = new URLSearchParams({
    code: code,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code'
  });

  const response = await fetch(
    'https://accounts.zoho.in/oauth/v2/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    }
  );

  const result = await response.json();

  if (!response.ok || result.error || !result.refresh_token) {
    console.error('Token exchange failed:', result.error || result);
    process.exitCode = 1;
  } else {
    console.log('\nSuccess! Zoho refresh token generated.');
    console.log('\nAdd this line to your .env file:');
    console.log('ZOHO_REFRESH_TOKEN=' + result.refresh_token);
    console.log('\nKeep this token private.');
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}

