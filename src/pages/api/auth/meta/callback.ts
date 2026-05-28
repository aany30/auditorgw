import { NextApiRequest, NextApiResponse } from 'next';

interface MetaOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaAccountsResponse {
  data: Array<{
    id: string;
    name: string;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    // Exchange code for access token
    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.NEXT_PUBLIC_META_REDIRECT_URI || 'http://localhost:3000/api/auth/meta/callback';

    if (!appId || !appSecret) {
      console.error('Missing Meta OAuth configuration');
      return res.redirect('/?error=missing_config');
    }

    const tokenResponse = await fetch('https://graph.instagram.com/v18.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code: code as string,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      console.error('Token exchange failed:', error);
      return res.redirect('/?error=token_exchange_failed');
    }

    const tokenData = (await tokenResponse.json()) as MetaOAuthResponse;
    const accessToken = tokenData.access_token;

    // Fetch user's business accounts and pixels
    const accountsResponse = await fetch(
      `https://graph.instagram.com/v18.0/me/accounts?access_token=${accessToken}`
    );

    if (!accountsResponse.ok) {
      console.error('Failed to fetch accounts');
      return res.redirect('/?error=fetch_accounts_failed');
    }

    const accountsData = (await accountsResponse.json()) as MetaAccountsResponse;
    const pixels = accountsData.data || [];

    // Redirect to dashboard with token and accounts as query params
    // Note: In production, you should store this server-side and pass a session ID instead
    const pixelIds = pixels.map((p) => p.id).join(',');
    const pixelNames = pixels.map((p) => p.name).join('|');
    const businessId = pixels[0]?.id || '';

    res.redirect(
      `/app/dashboard?meta_token=${encodeURIComponent(accessToken)}&business_id=${businessId}&pixel_ids=${pixelIds}&pixel_names=${encodeURIComponent(
        pixelNames
      )}`
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/?error=oauth_error');
  }
}
